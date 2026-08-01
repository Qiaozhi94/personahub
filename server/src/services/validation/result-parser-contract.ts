export interface ResultParserLimits {
  summaryMaxBytes: number;
  findingsMax: number;
  findingMessageMaxBytes: number;
  findingSuggestionMaxBytes: number;
  findingRefsMax: number;
  refsMax: number;
  missingEvidenceMax: number;
  decisionsMax: number;
  lessonsMax: number;
  itemMaxBytes: number;
}

export const DEFAULT_RESULT_PARSER_LIMITS: ResultParserLimits = {
  summaryMaxBytes: 8 * 1024,
  findingsMax: 100,
  findingMessageMaxBytes: 4 * 1024,
  findingSuggestionMaxBytes: 4 * 1024,
  findingRefsMax: 50,
  refsMax: 200,
  missingEvidenceMax: 200,
  decisionsMax: 50,
  lessonsMax: 50,
  itemMaxBytes: 4 * 1024,
};

export class ResultParseError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ResultParseError";
  }
}
