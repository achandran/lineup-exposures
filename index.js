// Tournament algorithm to generate lineups from only exposures and salaries
const _ = require('underscore');
const pool = require('./samplePool.json'); // sample NBA fanduel pool from 12/12/16

// default to one lineup if no argument provided
const lineupsToBuild = process.argv[2] || 1;

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

function getLineupSummary(lineup) {
  const lineupKey = getLineupKey(lineup);
  const formattedSalary = getFormattedCurrency(getSalary(lineup));
  return `${lineupKey} (${formattedSalary})`;
}

// get players who are eligible to fill a lineup at a given position
function getPositionCandidates(playerPool, prep, position, remainingSalary) {
  return playerPool.filter(player =>
      _.includes(player.pos, position) && player.salary < remainingSalary);
}

function getEligiblePlayer(playerPool, prep, position, remainingSalary) {
  const candidates = getPositionCandidates(playerPool, prep, position, remainingSalary);
  if (candidates.length === 0) {
    return null;
  }
  const nonLikedCandidates = candidates.filter(player => !player.liked);
  const selectedLikedId = _.sample(prep[position]);

  if (selectedLikedId) {
    const selectedLikedArr = candidates.filter(player => player.id === selectedLikedId);
    if (_.isEmpty(selectedLikedArr)) {
      return null;
    }
    return selectedLikedArr[0];
  }
  return _.sample(nonLikedCandidates);
}

function getInitialExposures(outputCount, playerPool) {
  return playerPool.filter(player => player.liked)
    .reduce((acc, curr) => Object.assign(acc,
    { [curr.id]: { count: 0, max: Math.ceil(curr.liked * outputCount) } }), {});
}

function isValidLineup(lineup, salaryFloor, salaryCap, exposures) {
  const salary = getSalary(lineup);
  const hasValidExposure = function hasValidExposure(player) {
    // nonliked players always pass exposure check
    if (!exposures[player.id]) {
      return true;
    }
    return exposures[player.id].count + 1 <= exposures[player.id].max;
  };
  return salary > salaryFloor && salary < salaryCap && lineup.every(hasValidExposure);
}

// generate a weighted distribution of liked players for a given position
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

// generate and return liked distributions for each position and max exposures
function generateLineupPrep(outputCount, playerPool, positions) {
  const likedDistributions = positions.reduce((acc, curr) => {
    const posSubPool = playerPool.filter(player => _.includes(player.pos, curr));
    const posDist = generatePosDist(posSubPool);
    return Object.assign(acc, { [curr]: posDist });
  }, {});
  const exposures = getInitialExposures(outputCount, playerPool);
  return Object.assign(likedDistributions, { exposures });
}

function generateLineup(playerPool, prep, positions, salaryFloor, salaryCap) {
  const partialLineup = [];
  for (let posId = 0; posId < positions.length; posId += 1) {
    const remainingSalary = salaryCap - getSalary(partialLineup);
    const selection = getEligiblePlayer(playerPool, prep, positions[posId], remainingSalary);
    if (!selection) {
      return null;
    }
    partialLineup.push(selection);
  }
  return partialLineup;
}

function generateLineups(outputCount, playerPool, prep, positions, salaryFloor, salaryCap) {
  const lineups = [];
  const lineupKeys = {};
  const maxConsecutiveAttempts = 500;
  let consecutiveAttemptNum = 0;
  // store current and max exposures for liked players as we build lineups
  let exposures = prep.exposures;
  // update the exposure count while keeping the max
  const updateExposure = (acc, curr) => Object.assign(acc, { [curr.id]:
    { count: exposures[curr.id].count + 1, max: exposures[curr.id].max } });
  while (lineups.length < outputCount && consecutiveAttemptNum < maxConsecutiveAttempts) {
    const candidate = generateLineup(playerPool, prep, positions, salaryFloor, salaryCap);
    if (candidate) {
      const lineupKey = getLineupKey(candidate);
      const isValid = isValidLineup(candidate, salaryFloor, salaryCap, exposures);
      // only add distinct, valid lineups
      if (!lineupKeys[lineupKey] && isValid) {
        lineupKeys[lineupKey] = candidate;
        const updatedExposures = candidate.filter(player => player.liked)
          .reduce(updateExposure, {});
        exposures = Object.assign(exposures, updatedExposures);
        lineups.push(candidate);
        consecutiveAttemptNum = 0;
      }
      consecutiveAttemptNum += 1;
    }
  }
  return lineups;
}

function printLineups(lineups) {
/* eslint-disable no-console */
  lineups.sort((lineA, lineB) => getSalary(lineB) - getSalary(lineA))
    .forEach(lineup => console.log(getLineupSummary(lineup)));
/* eslint-enable no-console */
}

function printMetadata(salaryFloor, salaryCap, numLineups, prep, hrtime) {
/* eslint-disable no-console */
  console.log(`salary from ${getFormattedCurrency(salaryFloor)} to ${getFormattedCurrency(salaryCap)}`);
  console.log(`Generated ${numLineups} lineups in ${hrtime[0]}s ${hrtime[1]}ns`);
  console.log('id\t\tcount\t\ttarget');
  Object.keys(prep.exposures).forEach(id =>
      console.log(`${id}\t\t${prep.exposures[id].count}\t\t${prep.exposures[id].max}`));
/* eslint-enable no-console */
}

(function run(outputCount) {
  // fanduel nba settings
  const salaryCap = 60000;
  const salaryFloor = 0.95 * salaryCap;
  const positions = ['PG', 'SG', 'SF', 'PF', 'C', 'PG', 'SG', 'SF', 'PF'];

  // store liked exposure distribution as well as max exposures
  const prep = generateLineupPrep(outputCount, pool, positions);

  const hrStart = process.hrtime();
  const lineups = generateLineups(outputCount, pool, prep, positions, salaryFloor, salaryCap);
  const hrEnd = process.hrtime(hrStart);

  printLineups(lineups);
  printMetadata(salaryFloor, salaryCap, lineups.length, prep, hrEnd);
}(lineupsToBuild));
