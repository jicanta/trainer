#!/usr/bin/env node
'use strict';
// A stand-in for the GitHub CLI: records the arguments it was called with and answers like `gh issue create`.
const fs = require('node:fs');
if (process.env.CPGYM_GH_LOG) fs.writeFileSync(process.env.CPGYM_GH_LOG, JSON.stringify(process.argv.slice(2)));
process.stdout.write('https://github.com/example/repo/issues/7\n');
