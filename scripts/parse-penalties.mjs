// Reads a round's penalties.txt — the stewards' post-race decisions, which the
// game's result file can't contain because they're made after the event.
//
// One penalty per line:   car, session, penalty, reason
//
//     24,  Race 1,  +30s,        Cut the chicane lap 12
//     117, Race 1,  DSQ,         Unsafe release
//     9,   Race 1,  drop 2,      Avoidable contact
//     35,  Qualifying, lap deleted, Track limits
//
// Blank lines are ignored, as are comment lines starting with "# " or "//" (put
// "# " in front of a line to switch it off). The reason is optional
// and may contain commas.
//
//  car      the number shown on the site, e.g. 24 or #24. If two classes share a
//           number, put the class first: "LMGT3 24".
//  session  Race 1 / Race 2 / Qualifying (R1, R2, Q, Quali also work)
//  penalty  +30s (seconds added to the race time)   -  race
//           DSQ (disqualified)                       -  race or qualifying
//           drop 3 (move down three places)           -  race
//           lap deleted (their fastest lap is removed) - qualifying

export function normaliseSession(text) {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  let m = t.match(/^(?:race|r)\s*(\d+)?$/);
  if (m) return `race:${m[1] || 1}`;
  m = t.match(/^(?:qualifying|qualify|quali|q)\s*(\d+)?$/);
  if (m) return `quali:${m[1] || 1}`;
  return null;
}

function parsePenaltyText(text) {
  const t = text.trim();
  let m = t.match(/^\+\s*(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)?$/i) || t.match(/^(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)$/i);
  if (m) return { kind: "time", seconds: parseFloat(m[1]) };
  if (/^(?:dsq|dq|disqualified|disqualification)$/i.test(t)) return { kind: "dsq" };
  m = t.match(/^(?:drop|-)\s*(\d+)\s*(?:places?|positions?)?$/i);
  if (m) return { kind: "drop", places: parseInt(m[1], 10) };
  if (/^(?:delete(?:d)?\s*(?:best\s*|fastest\s*)?lap|(?:best\s*|fastest\s*)?lap\s*delete(?:d)?)$/i.test(t)) return { kind: "deleteLap" };
  return null;
}

/** @returns {{ penalties: object[], problems: string[] }} */
export function parsePenalties(text, fileLabel = "penalties.txt") {
  const penalties = [];
  const problems = [];
  text.replace(/^\uFEFF/, "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    // A comment starts with "# " (or "//"). A "#" straight before a digit is a
    // car number written as #24, so that is a penalty, never a comment —
    // silently ignoring a penalty would be much worse than reading a comment.
    if (!line || /^#(?!\d)/.test(line) || line.startsWith("//")) return;
    const where = `${fileLabel} line ${i + 1}`;
    const parts = line.split(",");
    if (parts.length < 3) {
      problems.push(`${where}: expected "car, session, penalty, reason" but got "${line}"`);
      return;
    }
    const [carRaw, sessionRaw, penaltyRaw, ...reasonParts] = parts;
    const session = normaliseSession(sessionRaw);
    if (!session) return problems.push(`${where}: don't understand the session "${sessionRaw.trim()}" (use Race 1, Race 2 or Qualifying)`);
    const penalty = parsePenaltyText(penaltyRaw);
    if (!penalty) return problems.push(`${where}: don't understand the penalty "${penaltyRaw.trim()}" (use +30s, DSQ, drop 2 or lap deleted)`);
    const carMatch = carRaw.trim().match(/^(?:(.+?)\s+)?#?(\d+)$/);
    if (!carMatch) return problems.push(`${where}: don't understand the car "${carRaw.trim()}" (use the number, e.g. 24)`);
    penalties.push({
      ...penalty,
      session,
      sessionText: sessionRaw.trim(),
      car: carMatch[2],
      classHint: carMatch[1] ? carMatch[1].trim().toLowerCase() : null,
      reason: reasonParts.join(",").trim(),
      line: i + 1,
      where,
      applied: false,
    });
  });
  return { penalties, problems };
}
