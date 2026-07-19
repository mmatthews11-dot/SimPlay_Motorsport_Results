// Parses a SimGrid championship "Races" page to find which rounds have
// published results yet. Each round's info lives in a
// <div class="tab-pane" id="information-round{raceId}">, which contains both
// the round's heading (e.g. "Round 1 Le Mans") and, once results exist, a
// "View Results" link with both race_id and round_id in its href. Rounds that
// haven't happened yet have no such link, so they're skipped naturally.

import * as cheerio from "cheerio";

export function parseRacesPage(html) {
  const $ = cheerio.load(html);
  const races = [];

  $('div.tab-pane[id^="information-round"]').each((_, el) => {
    const $pane = $(el);
    const raceId = $pane.attr("id").replace("information-round", "");

    const label = $pane.find("h4.fs-m").first().text().replace(/\s+/g, " ").trim();

    const resultsLink = $pane.find('a[href*="results?race_id="]').first().attr("href");
    if (!resultsLink) return; // round hasn't happened yet, no results link

    const url = new URL(resultsLink, "https://www.thesimgrid.com");
    const roundId = url.searchParams.get("round_id");
    const linkedRaceId = url.searchParams.get("race_id");

    if (!roundId || !linkedRaceId) return;

    races.push({
      raceId: linkedRaceId,
      roundId,
      label: label || `Race ${linkedRaceId}`,
    });
  });

  return races;
}
