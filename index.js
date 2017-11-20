"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const path_1 = require("path");
const match = require("minimatch");
function createMatcher(raw) {
    // format `<pathPattern>|<namePattern>:<lineNumber>`
    let pipe = raw.lastIndexOf('|');
    let colon = raw.lastIndexOf(':');
    if (pipe < 0) {
        return node => {
            // filename matching only
            return match(node.getSourceFile().fileName, raw);
        };
    }
    else {
        let pathPattern = raw.substring(0, pipe);
        let namePattern = raw.substring(pipe + 1);
        let lineNumber = Number(raw.substring(colon + 1)) || undefined;
        return node => {
            const source = node.getSourceFile();
            if (pathPattern && match(source.fileName, pathPattern)) {
                return true;
            }
            if (namePattern && match(node.getText(), namePattern)) {
                return true;
            }
            if (lineNumber && source.getLineAndCharacterOfPosition(node.getStart()).line + 1 === lineNumber) {
                return true;
            }
            return false;
        };
    }
}
function createFilter() {
    let defaultExcludes = ['**/test/**', '**.test.ts', '**/*.d.ts'];
    let exclude = ~process.argv.indexOf('--ignoreCheck');
    if (exclude) {
        let excludeFile = ts.sys.readFile(process.argv[~exclude + 1]);
        defaultExcludes = excludeFile.split('\n').filter(s => Boolean(s));
    }
    const all = defaultExcludes.map(createMatcher);
    return node => {
        for (const match of all) {
            if (match(node)) {
                return false;
            }
        }
        return true;
    };
}
const host = new class {
    constructor() {
        const args = process.argv.slice(2);
        const cmd = ts.parseCommandLine(args);
        const result = ts.parseJsonText(cmd.options.project, ts.sys.readFile(cmd.options.project));
        const configParseResult = ts.parseJsonSourceFileConfigFileContent(result, ts.sys, path_1.dirname(cmd.options.project));
        this._host = ts.createCompilerHost(configParseResult.options);
        this._config = configParseResult;
    }
    getCompilationSettings() {
        return this._config.options;
    }
    getScriptFileNames() {
        return this._config.fileNames;
    }
    getScriptVersion(fileName) {
        return '1';
    }
    getScriptSnapshot(fileName) {
        try {
            return ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName));
        }
        catch (_a) {
            return undefined;
        }
    }
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
        throw new Error("Method not implemented.");
    }
    getDefaultLibFileName(options) {
        return this._host.getDefaultLibFileName(options);
    }
    getCurrentDirectory() {
        return this._host.getCurrentDirectory();
    }
    getDirectories(path) {
        return this._host.getDirectories(path);
    }
    getCanonicalFileName(fileName) {
        return this._host.getCanonicalFileName(fileName);
    }
    useCaseSensitiveFileNames() {
        return this._host.useCaseSensitiveFileNames();
    }
    getNewLine() {
        return this._host.getNewLine();
    }
    fileExists(fileName) {
        return this._host.fileExists(fileName);
    }
    readFile(fileName) {
        return this._host.readFile(fileName);
    }
};
function isReferenced(service, node) {
    const source = node.getSourceFile();
    const fileName = source.fileName;
    const span = { start: node.parent.getStart(), end: node.parent.getEnd() };
    for (const { definition, references } of service.findReferences(fileName, node.getStart())) {
        for (const reference of references) {
            if (reference.isDefinition) {
                // ignore definition
                continue;
            }
            if (match(reference.fileName, '{**/test/**,**.test.ts}')) {
                // ignore test-files
                continue;
            }
            if (definition.kind === ts.ScriptElementKind.classElement
                && reference.fileName === fileName
                && reference.textSpan.start >= span.start && reference.textSpan.start + reference.textSpan.length < span.end) {
                // ignore references from within
                continue;
            }
            return true;
        }
    }
    return false;
}
function collectTargets(node, filter, bucket) {
    ts.forEachChild(node, child => {
        if (!node.modifiers || !node.modifiers.some(value => value.kind === ts.SyntaxKind.PrivateKeyword)) {
            let ident;
            switch (node.kind) {
                case ts.SyntaxKind.InterfaceDeclaration:
                case ts.SyntaxKind.ClassDeclaration:
                case ts.SyntaxKind.MethodDeclaration:
                case ts.SyntaxKind.FunctionDeclaration:
                case ts.SyntaxKind.PropertyDeclaration:
                case ts.SyntaxKind.ModuleDeclaration:
                case ts.SyntaxKind.EnumDeclaration:
                case ts.SyntaxKind.TypeAliasDeclaration:
                    ident = node.name;
                    break;
            }
            if (ident && filter(ident)) {
                bucket.add(ident);
            }
        }
        collectTargets(child, filter, bucket);
    });
}
class UnusedSymbolRecord {
    constructor(fileName, symbolName, start, end, span = 1 + end.line - start.line) {
        this.fileName = fileName;
        this.symbolName = symbolName;
        this.start = start;
        this.end = end;
        this.span = span;
        //
    }
    static compareBySpan(a, b) {
        return a.span - b.span;
    }
    toString() {
        return `${this.fileName}|${this.symbolName}:${1 + this.start.line} -> potentially save ~${this.span} lines`;
    }
}
const filter = createFilter();
const service = ts.createLanguageService(host);
const unused = [];
let totalLines = 0;
for (const file of service.getProgram().getSourceFiles()) {
    let fileLines = 0;
    let targets = new Set();
    collectTargets(file, filter, targets);
    for (const target of targets) {
        if (!isReferenced(service, target)) {
            const start = file.getLineAndCharacterOfPosition(target.parent.getStart());
            const end = file.getLineAndCharacterOfPosition(target.parent.getEnd());
            const record = new UnusedSymbolRecord(file.fileName, target.getText(), start, end);
            unused.push(record);
            console.error(record.toString());
            fileLines += record.span;
        }
    }
    if (fileLines > 0) {
        totalLines += fileLines;
        console.error(`${file.fileName} -> potentially save ${fileLines} lines`);
    }
}
console.log(`Found ${unused.length} unused symbols with potential for saving ${totalLines} lines of unused code`);
console.log(unused.join('\n'));
