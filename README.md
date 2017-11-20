# Bloaty McBloatface

A tool that finds unused (public/exported) symbols in a TypeScript project. 

Run it like so: `node index.js -p /path/to/tsconfig.json --ignoreCheck /path/to/ignoreCheck.txt`. 

The `ignoreCheck`-flag allows to define files and symbols that are be to excluded. Each line is a rule like this `<fileNamePattern>|<symbolNamePatern>:<lineNumber>`, e.g. `**/*.d.ts` or `|toJSON` etc. Check this file as a sample: https://github.com/jrieken/ts-unused/blob/master/exclude.txt

