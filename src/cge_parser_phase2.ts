/**
 * Unified interface that all language-specific parsers must implement.
 * This guarantees the compiler orchestrator receives standardized CGE component lists.
 */
export interface CGEParserPhase2 {
  /**
   * Parses raw source code and groups elements into standardized CGE sections.
   * @param code The raw source code of the file.
   * @param fileName Optional file path/name for context.
   */
  parse(code: string, fileName?: string): {
    imports: string[];
    types: string[];
    state: string[];
    ops: string[];
    privateOps: string[];
    exports: string[];
    routes?: string[];
    middleware?: string[];
    permissions?: string[];
    dependencies?: string[];
    entityRelations?: string[];
    methods?: string[];
    eventEmissions?: string[];
    eventListeners?: string[];
    cronJobs?: string[];
    calls?: string[];
    classProperties?: string[];
  };
}

