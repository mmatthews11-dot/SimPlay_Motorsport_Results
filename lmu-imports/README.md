# LMU result files

Drop the game's result files (the `.xml` files) in here after each event. The
site updates itself within a minute or two — there is nothing else to do.

## Where to put them

One folder per season, and inside it one folder per round. The folder names are
exactly what appears on the website:

```
lmu-imports/
  Season 2/
    Round 1 Interlagos/
      2026_09_08_20_24_35-96Q1_Interlagos_Quali.xml
      2026_09_08_22_09_32-25R1_Interlagos.xml
    Round 2 Imola/
      (the qualifying and race files for round 2)
```

Keep the files' original names — they are only used to tell qualifying from the race.

## Adding a round (on github.com)

1. Open `lmu-imports` → `Season 2`.
2. **Add file → Upload files**, and drag in the round's folder (e.g. `Round 2 Imola`) with its files inside.
3. Commit. The "Build LMU results from uploaded files" action then runs and updates the site.

## Good to know

- **A file in the wrong place or one that isn't a race/qualifying file** is skipped, and the Actions run shows a yellow note saying which one and why.
- **Fixing a mistake:** upload the corrected file into the same round folder. If the same session is there twice, the later one is used. Or just delete the old file.
- **A new season:** make a new season folder, e.g. `Season 3`. Add a season's rounds in order and it appears as a new season button on the site.
- A season with files in this folder uses *only* these files on the site; SimGrid's pages aren't used for that season.
