
import * as ts from 'typescript';
import { dirname } from 'path';

const host = new class implements ts.LanguageServiceHost {

    private _host: ts.CompilerHost;
    private _config: ts.ParsedCommandLine;

    constructor() {
        const args = process.argv.slice(2);
        const cmd = ts.parseCommandLine(args);
        const result = ts.parseJsonText(cmd.options.project, ts.sys.readFile(cmd.options.project));
        const configParseResult = ts.parseJsonSourceFileConfigFileContent(result, ts.sys, dirname(cmd.options.project));
        this._host = ts.createCompilerHost(configParseResult.options);
        this._config = configParseResult;
    }

    getCompilationSettings(): ts.CompilerOptions {
        return this._config.options;
    }
    getScriptFileNames(): string[] {
        return this._config.fileNames;
    }
    getScriptVersion(fileName: string): string {
        return '1';
    }
    getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
        try {
            return ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName))
        } catch {
            return undefined;
        }
    }
    getSourceFile(fileName: string, languageVersion: ts.ScriptTarget, onError?: ((message: string) => void) | undefined, shouldCreateNewSourceFile?: boolean | undefined): ts.SourceFile | undefined {
        throw new Error("Method not implemented.");
    }
    getDefaultLibFileName(options: ts.CompilerOptions): string {
        return this._host.getDefaultLibFileName(options);
    }
    getCurrentDirectory(): string {
        return this._host.getCurrentDirectory()
    }
    getDirectories(path: string): string[] {
        return this._host.getDirectories(path)
    }
    getCanonicalFileName(fileName: string): string {
        return this._host.getCanonicalFileName(fileName)
    }
    useCaseSensitiveFileNames(): boolean {
        return this._host.useCaseSensitiveFileNames()
    }
    getNewLine(): string {
        return this._host.getNewLine()
    }
    fileExists(fileName: string): boolean {
        return this._host.fileExists(fileName)
    }
    readFile(fileName: string): string | undefined {
        return this._host.readFile(fileName)
    }
}

function isReferenced(service: ts.LanguageService, node: ts.Node): boolean {

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

function acceptFile(file: ts.SourceFile): boolean {
    if (file.fileName.endsWith('.d.ts') // no .d.ts-files
        || file.fileName.endsWith('.test.ts') // no .test.ts-files
        || file.fileName.includes('/test/') // no files in /test/
        || file.fileName.endsWith('/extHost.api.impl.ts') // api implementation
    ) {
        return false;
    }
    return true;
}

function acceptName(node: ts.Node): boolean {
    const text = node.getText();
    if (text === 'toString' || text === 'dispose' || text === 'toJSON') {
        // ignore built-in symbols
        return false;
    } else if (text.startsWith('_') && text.endsWith('Brand')) {
        // ignore the brand pattern
        return false;
    } else if (text.startsWith('$') && (node.getSourceFile().fileName.startsWith('extHost') || node.getSourceFile().fileName.startsWith('mainThread'))) {
        // ignore IPC-methods
        return false;
    }
    return true;
}

function collectTargets(node: ts.Node, bucket: Set<ts.Node>): void {
    ts.forEachChild(node, child => {

        if (!node.modifiers || !node.modifiers.some(value => value.kind === ts.SyntaxKind.PrivateKeyword)) {

            let ident: ts.Node;
            switch (node.kind) {
                case ts.SyntaxKind.InterfaceDeclaration:
                case ts.SyntaxKind.ClassDeclaration:
                case ts.SyntaxKind.MethodDeclaration:
                case ts.SyntaxKind.FunctionDeclaration:
                case ts.SyntaxKind.PropertyDeclaration:
                case ts.SyntaxKind.ModuleDeclaration:
                case ts.SyntaxKind.EnumDeclaration:
                case ts.SyntaxKind.TypeAliasDeclaration:
                    ident = (node as any).name;
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
    let targets = new Set<ts.Node>();
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

