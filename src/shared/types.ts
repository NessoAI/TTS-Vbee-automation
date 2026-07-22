export type RunMode = 'review_twice' | 'full_auto';
export type Speaker = 'A' | 'B';

export interface DialogueTurn {
  order: number;
  speaker: Speaker;
  text: string;
}

export interface DialogueResult {
  roles: { A: string; B: string };
  dialogue: DialogueTurn[];
}

export type JobStatus =
  | 'created'
  | 'extracting_document'
  | 'correcting_text'
  | 'assigning_roles'
  | 'awaiting_script_review'
  | 'creating_vbee_project'
  | 'pasting_vbee_blocks'
  | 'awaiting_vbee_review'
  | 'generating_audio'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ValidationIssue {
  code: string;
  message: string;
  turn?: number;
  severity: 'error' | 'warning';
}

export interface Job {
  id: string;
  documentUrl: string;
  documentTitle?: string;
  mode: RunMode;
  status: JobStatus;
  sourceText?: string;
  correctedText?: string;
  dialogue?: DialogueResult;
  validationIssues: ValidationIssue[];
  correctionAttempts?: number;
  rolePromptVersion?: string;
  rolePromptSource?: string;
  rolePromptTemplateSha256?: string;
  rolePromptRenderedSha256?: string;
  vbeeProjectUrl?: string;
  downloadedFile?: string;
  error?: string;
  logs?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AppConfig {
  serverPort: number;
  browser: {
    profileDir: string;
    headless: boolean;
    channel: 'chrome' | 'msedge' | 'chromium';
    followActiveTab: boolean;
  };
  chatgpt: {
    projectName: string;
    baseUrl: string;
    projectUrl?: string;
  };
  vbee: {
    projectsUrl: string;
    voiceA: string;
    speedA: string;
    voiceB: string;
    speedB: string;
    maxBlockCharacters: number;
  };
  files: {
    downloadsDir: string;
    destinationDir: string;
  };
  automation: {
    dryRun: boolean;
    timeoutMs: number;
    generationTimeoutMs: number;
  };
}
