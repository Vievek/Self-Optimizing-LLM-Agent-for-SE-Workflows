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

  async generateFix(signal: OptimizationSignal, currentValue: unknown): Promise<FixCandidate> {
    const prompt = `You are an Optimization Orchestrator assisting an autonomous SE agent.
Failure Class: ${signal.failure_class}
Root Cause: ${signal.root_cause.summary}
Target Axis: ${signal.target.axis}
Config Path: ${signal.target.config_path}
Suggested Action: ${signal.suggested_action}
Current Value: ${JSON.stringify(currentValue)}

Propose a minimal configuration update as a valid JSON object:
{
  "proposedValue": <value>,
  "rationale": "<short rationale>"
}`;

    const res = await this.llm.chat({
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            'You generate structured JSON configuration patches. Return a valid JSON object containing proposedValue and rationale, without additional explanation.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    });

    // Extract the first JSON object from the model response.
    const jsonMatch = res.content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return {
        configPath: signal.target.config_path,
        proposedValue: currentValue,
        rationale: 'LLM response did not contain a JSON object; current value retained.',
      };
    }

    try {
      const parsed: unknown = JSON.parse(jsonMatch[0]);

      if (typeof parsed !== 'object' || parsed === null || !('proposedValue' in parsed)) {
        return {
          configPath: signal.target.config_path,
          proposedValue: currentValue,
          rationale: 'LLM JSON did not contain proposedValue; current value retained.',
        };
      }

      const result = parsed as {
        proposedValue?: unknown;
        rationale?: unknown;
      };

      return {
        configPath: signal.target.config_path,
        proposedValue: result.proposedValue ?? currentValue,
        rationale:
          typeof result.rationale === 'string'
            ? result.rationale
            : 'LLM-generated configuration update',
      };
    } catch {
      // Keep the pipeline running if the model returns malformed JSON.
      return {
        configPath: signal.target.config_path,
        proposedValue: currentValue,
        rationale: 'LLM response contained invalid JSON; current value retained.',
      };
    }
  }
}
