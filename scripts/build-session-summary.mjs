// Turns the per-class rows scraped from SimGrid into one session summary
// object. Classes are kept fully separate — SimGrid publishes an official
// position per class, and we don't second-guess that with any computed
// "Overall" combined ranking across classes.
//
// Shaped to line up with the ACC dashboard's existing field names (driver,
// car, bestLap, referenceTimeMs, etc.) so the dashboard rendering code can be
// reused with minimal changes — just without an "Overall" tab, since that
// concept doesn't apply here.

/**
 * @param {Array<{classId:string, classLabel:string, rows:Array}>} classResults
 * @param {object} meta - { raceId, roundId, roundLabel, sessionType, sessionName, championshipName }
 */
export function buildSessionSummary(classResults, meta) {
  const isRace = meta.sessionType.startsWith("race");

  const standingsByClass = {};
  let fastestLap = null;
  let totalDrivers = 0;

  for (const { classLabel, rows } of classResults) {
    if (rows.length === 0) continue;
    totalDrivers += rows.length;

    const classStandings = rows.map((row) => {
      const referenceTimeMs = row.bestLapMs; // used for gap-bar visualisation within the class
      if (row.bestLapMs != null && (!fastestLap || row.bestLapMs < fastestLap.bestLapMs)) {
        fastestLap = { driver: row.driver, bestLap: row.bestLap, bestLapMs: row.bestLapMs };
      }
      return {
        position: row.classPosition,
        classPosition: row.classPosition,
        driverClass: row.carClass || classLabel,
        raceNumber: row.carNumber,
        driver: row.driver,
        driverProfileUrl: row.driverProfileUrl,
        car: row.vehicle,
        laps: row.laps,
        bestLap: row.bestLap,
        bestLapMs: row.bestLapMs,
        referenceTimeMs,
        totalTimeDisplay: row.totalTimeDisplay,
        gapDisplay: row.gapDisplay,
        status: row.status,
        hasMandatoryPitstopIssue: false,
      };
    });

    standingsByClass[classLabel] = classStandings;
  }

  return {
    id: `${meta.raceId}-${meta.sessionType}`,
    game: "LMU",
    sourceFile: `${meta.raceId}-${meta.sessionType}`,
    sessionType: isRace ? "R" : "Q",
    sessionName: meta.sessionName,
    trackName: meta.roundLabel,
    serverName: meta.championshipName || null,
    isWetSession: false,
    fastestLapDriver: fastestLap?.driver ?? null,
    fastestLapTime: fastestLap?.bestLap ?? null,
    totalDrivers,
    standingsByClass,
  };
}
