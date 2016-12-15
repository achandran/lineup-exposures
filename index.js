// Tournament algorithm to generate lineups from only exposures and salaries

const _ = require('underscore');
// sample NBA fanduel pool from 12/12/16
const pool = require('./samplePool.json');

const outputCount = process.argv[2] || 1;

// returns the salary for a lineup or partial lineup
function getSalary(lineup) {
  return lineup.reduce((acc, curr) => acc + curr.salary, 0);
}

function getFormattedCurrency(usd) {
  return usd.toLocaleString('en', { style: 'currency', currency: 'usd' });
}

// unique id assigned to each lineup to prevent duplicates
function getLineupKey(lineup) {
  return lineup.map(player => player.id).join('-');
}

function isValidLineup(lineup, salaryFloor, salaryCap) {
  const salary = getSalary(lineup);
  return salary > salaryFloor && salary < salaryCap;
}

function getLineupSummary(lineup) {
  const lineupKey = getLineupKey(lineup);
  const formattedSalary = getFormattedCurrency(getSalary(lineup));
  return `${lineupKey} (${formattedSalary})`;
}

function generatePosDist(posSubPool) {
  const liked = posSubPool.filter(player => player.liked);
  const likedDist = liked.reduce((acc, curr) =>
      acc.concat(_.range(curr.liked * 100).map(() => curr.id)), []);
  const diff = 100 - likedDist.length;
  if (diff > 0) {
    return likedDist.concat(_.range(diff).map(() => null));
  }
  return likedDist;
}

function generateLineupPrep(playerPool, positions) {
  return positions.reduce((acc, curr) => {
    const posSubPool = playerPool.filter(player => _.includes(player.pos, curr));
    const posDist = generatePosDist(posSubPool);
    return Object.assign(acc, { [curr]: posDist });
  }, {});
}

// get players who are eligible to fill a lineup at a given position
function getPositionCandidates(playerPool, prep, position, remainingSalary) {
  return playerPool.filter(player =>
      _.includes(player.pos, position) && player.salary < remainingSalary);
}

function generateLineup(playerPool, prep, positions, salaryFloor, salaryCap) {
  const partialLineup = [];
  let posId = 0;
  let attempt = 0;

  while (posId < positions.length && attempt < 1000) {
    const remainingSalary = salaryCap - getSalary(partialLineup);
    // TODO: change candidate selection to use min and max exposures (prep)
    const candidates = getPositionCandidates(playerPool, prep, positions[posId], remainingSalary);
    // null indicates an invalid lineup
    if (candidates.length === 0) {
      return null;
    }
    const selection = _.sample(candidates);
    partialLineup.push(selection);
    posId += 1;
    attempt += 1;
  }
  return partialLineup;
}

function generateLineups(playerPool, prep, positions, salaryFloor, salaryCap) {
  const lineups = [];
  const lineupKeys = {};
  const maxAttempts = 10e6;

  let attempt = 0;
  while (lineups.length < outputCount && attempt < maxAttempts) {
    const candidate = generateLineup(playerPool, prep, positions, salaryFloor, salaryCap);
    if (candidate !== null) {
      const lineupKey = getLineupKey(candidate);
      // only add distinct, valid lineups
      if (!lineupKeys[lineupKey] && isValidLineup(candidate, salaryFloor, salaryCap)) {
        lineupKeys[lineupKey] = candidate;
        lineups.push(candidate);
      }
      attempt += 1;
    }
  }
  return lineups;
}

function printLineups(lineups) {
  lineups.sort((lineA, lineB) => getSalary(lineB) - getSalary(lineA))
    .forEach(lineup => console.log(getLineupSummary(lineup)));
}

function printMetadata(salaryFloor, salaryCap, numLineups, hrtime) {
  console.log(`salaryCap = ${getFormattedCurrency(salaryCap)}`);
  console.log(`salaryFloor = ${getFormattedCurrency(salaryFloor)}`);
  console.log(`Generated ${numLineups} lineups in ${hrtime[0]}s ${hrtime[1]}ns`);
}

(function run() {
  // fanduel nba settings
  const salaryCap = 60000 * (5 / 9);
  const salaryFloor = 0.95 * salaryCap;

  const positions = ['PG', 'SG', 'SF', 'PF', 'C'];

  const prep = generateLineupPrep(pool, positions);

  const hrStart = process.hrtime();
  const lineups = generateLineups(pool, prep, positions, salaryFloor, salaryCap);
  const hrEnd = process.hrtime(hrStart);

  printLineups(lineups);
  printMetadata(salaryFloor, salaryCap, lineups.length, hrEnd);
}());
