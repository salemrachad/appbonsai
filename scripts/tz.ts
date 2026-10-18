// The tree's timezone for the scenario suites, whatever the machine's: "night", "morning" and the bench's START
// (a June morning) are local times. Cloudflare's build machines run in UTC, the laptop in Beirut. Import this
// FIRST, before anything reads the clock. (The golden master pins more in scripts/golden/env.ts.)
process.env.TZ = 'Asia/Beirut';
