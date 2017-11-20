
import * as ts from 'typescript';
import { dirname } from 'path';
import * as match from 'minimatch';

function createMatcher(raw: string): NodeFilter {
    // format `<pathPattern>|<namePattern>:<lineNumber>`
    let pipe = raw.lastIndexOf('|');
    let colon = raw.lastIndexOf(':');

    if (pipe < 0) {
        return node => {
            // filename matching only
            return match(node.getSourceFile().fileName, raw);
        };
    } else {
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

function createFilter(): NodeFilter {
    let defaultExcludes = ['**/test/**', '**.test.ts', '**/*.d.ts'];
    let exclude = ~process.argv.indexOf('--ignoreCheck')
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
    }
}

interface NodeFilter {
    (node: ts.Node): boolean;
}

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
                && reference.textSpan.start >= span.start && reference.textSpan.start + reference.textSpan.length < span.end
            ) {
                // ignore references from within
                continue;
            }
            return true;
        }
    }
    return false;
}

function collectTargets(node: ts.Node, filter: NodeFilter, bucket: Set<ts.Node>): void {
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

            if (ident && filter(ident)) {
                bucket.add(ident);
            }
        }

        collectTargets(child, filter, bucket);
    });
}

class UnusedSymbolRecord {
    constructor(
        readonly fileName: string,
        readonly symbolName: string,
        readonly start: ts.LineAndCharacter,
        readonly end: ts.LineAndCharacter,
        readonly span = 1 + end.line - start.line
    ) {
        //
    }

    static compareBySpan(a: UnusedSymbolRecord, b: UnusedSymbolRecord): number {
        return a.span - b.span;
    }

    toString(): string {
        return `${this.fileName}|${this.symbolName}:${1 + this.start.line} -> potentially save ~${this.span} lines`;
    }
}


const filter = createFilter();
const service = ts.createLanguageService(host);
const unused: UnusedSymbolRecord[] = [];
let totalLines = 0;

for (const file of service.getProgram().getSourceFiles()) {

    let fileLines = 0;
    let targets = new Set<ts.Node>();
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

