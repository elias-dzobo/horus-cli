/**
 * @typedef {Object} Journey
 * @property {string} name
 * @property {string} base_url
 * @property {JourneyStep[]} steps
 * @property {string=} source_path
 */

/**
 * @typedef {Object} FillStep
 * @property {{ selector: string, value: string }} fill
 */

/**
 * @typedef {Object} UploadStep
 * @property {{ selector: string, file: string }} upload
 */

/**
 * @typedef {Object} AgentStep
 * @property {{ goal: string, inputs?: Record<string, unknown>, max_steps?: number }} agent
 */

/**
 * @typedef {(
 *   { goto: string } |
 *   { click: string } |
 *   FillStep |
 *   UploadStep |
 *   AgentStep |
 *   { expect_text: string } |
 *   { expect_url_contains: string } |
 *   { wait_for_selector: string } |
 *   { wait_ms: number }
 * )} JourneyStep
 */

/**
 * @typedef {Object} StepRecord
 * @property {number} index
 * @property {string} label
 * @property {"passed" | "failed"} status
 * @property {string} started_at
 * @property {string} finished_at
 * @property {number} duration_ms
 * @property {string=} screenshot
 * @property {string=} error
 * @property {string[]=} agent_actions
 */

/**
 * @typedef {Object} ConsoleSignal
 * @property {string} type
 * @property {string} text
 * @property {string} timestamp
 */

/**
 * @typedef {Object} NetworkSignal
 * @property {string} url
 * @property {string} method
 * @property {number=} status
 * @property {string=} status_text
 * @property {string=} failure
 * @property {string} timestamp
 */

/**
 * @typedef {Object} RunResult
 * @property {string} run_id
 * @property {string} artifacts_dir
 * @property {Journey} journey
 * @property {StepRecord[]} steps
 * @property {ConsoleSignal[]} console
 * @property {NetworkSignal[]} network
 * @property {string} final_url
 * @property {boolean} passed
 * @property {StepRecord=} failed_step
 * @property {string=} failure_message
 * @property {string=} dom_snapshot
 * @property {string=} dom_snapshot_content
 * @property {{ command: string, journey_file?: string, base_url: string, run_id: string }} repro
 * @property {{ run_id: string, journey_id: string, session_id: string, headers: Record<string, string> }} correlation
 */

export {};
