import type { OptimizationSignal } from '@soa/contracts';
import type { LlmProvider } from '@soa/llm';

export interface FixCandidate {
  configPath: string;
  proposedValue: unknown;
  rationale: string;
}

/**
 * FixGenerator – FR2
 *
 * Emits candidate configuration changes targeted at signal.target.config_path.
 * Queries LlmProvider with structured instructions to propose minimal JSON updates.
 */
export class FixGenerator {
  constructor(
    private readonly llm: LlmProvider,
    private readonly model: string = 'gpt-4o-mini',
  ) {}

  async generateFix(
    signal: OptimizationSignal,
    currentValue: unknown,
  ): Promise<FixCandidate> {
    const prompt = `You are an Optimization Orchestrator assisting an autonomous SE agent.
Failure Class: ${signal.failure_class}
Root Cause: ${signal.root_cause.summary}
Target Axis: ${signal.target.axis}
Config Path: ${signal.target.config_path}
Suggested Action: ${signal.suggested_action}
Current Value: ${JSON.stringify(currentValue)}

Propose a validated JSON object with updated configuration for "${signal.target.config_path}":
{
  "proposedValue": <value>,
  "rationale": "<short rationale>"
}`;

    const res = await this.llm.chat({
      model: this.model,
      messages: [
        { role: 'system', content: 'You generate structured JSON configuration patches.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    });

    try {
      const parsed = JSON.parse(res.content);
      return {
        configPath: signal.target.config_path,
        proposedValue: parsed.proposedValue ?? currentValue,
        rationale: parsed.rationale ?? 'LLM-generated configuration update',
      };
    } catch {
      // Fallback for mock or text responses
      return {
        configPath: signal.target.config_path,
        proposedValue: currentValue,
        rationale: res.content.slice(0, 100),
      };
    }
  }
}
