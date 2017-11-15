"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const path_1 = require("path");
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
    const refsPerDef = service.findReferences(node.getSourceFile().fileName, node.getStart());
    if (!refsPerDef || refsPerDef.length === 0) {
        return false;
    }
    for (const refs of refsPerDef) {
        if (refs.references.length > 1) {
            return true;
        }
    }
    return false;
}
function acceptFile(file) {
    if (file.fileName.endsWith('.d.ts') // no .d.ts-files
        || file.fileName.endsWith('.test.ts') // no .test.ts-files
        || file.fileName.includes('/test/') // no files in /test/
        || file.fileName.endsWith('/extHost.api.impl.ts') // api implementation
    ) {
        return false;
    }
    return true;
}
function acceptName(node) {
    const text = node.getText();
    if (text === 'toString' || text === 'dispose' || text === 'toJSON') {
        // ignore built-in symbols
        return false;
    }
    else if (text.startsWith('_') && text.endsWith('Brand')) {
        // ignore the brand pattern
        return false;
    }
    else if (text.startsWith('$') && (node.getSourceFile().fileName.startsWith('extHost') || node.getSourceFile().fileName.startsWith('mainThread'))) {
        // ignore IPC-methods
        return false;
    }
    return true;
}
function collectTargets(node, bucket) {
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
            if (ident && acceptName(ident)) {
                bucket.add(ident);
            }
        }
        collectTargets(child, bucket);
    });
}
const service = ts.createLanguageService(host);
let totalLines = 0;
let fileCounter = 0;
for (const file of service.getProgram().getSourceFiles()) {
    if (!acceptFile(file)) {
        continue;
    }
    let fileLines = 0;
    let targets = new Set();
    collectTargets(file, targets);
    for (const target of targets) {
        const value = isReferenced(service, target);
        if (!value) {
            const start = file.getLineAndCharacterOfPosition(target.getStart());
            const lines = 1 + (file.getLineAndCharacterOfPosition(target.parent.getEnd()).line - file.getLineAndCharacterOfPosition(target.parent.getStart()).line);
            console.log(`${file.fileName} -> ${target.getText()}:${1 + start.line},${1 + start.character}, potentially save ~${lines} lines`);
            fileLines += lines;
        }
    }
    fileCounter += 1;
    totalLines += fileLines;
    console.error(`${file.fileName}, ${fileCounter}, ${totalLines} (+${fileLines})`);
}
console.log(`DONE with ${fileCounter} source files. Potential for saving ${totalLines} lines of unused code`);
