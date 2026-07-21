import { SAFETY_CONFIG } from '../utils/constant';

export interface SafetyCheckResult {
  isSafe: boolean;
  checks: {
    adversarial: { flag: boolean; label: string; score: number };
    nsfw: { flag: boolean; label: string; score: number };
    toxic: { flag: boolean; label: string; score: number };
  };
}

export class SafetyService {
  private async queryHFModel(modelId: string, text: string) {
    const token = process.env.HF_TOKEN;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(
      `${SAFETY_CONFIG.HUGGINGFACE_BASE_URL}/${modelId}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ inputs: text }),
      }
    );

    if (!response.ok) {
      throw new Error(`Hugging Face API call failed for ${modelId}: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Runs parallel evaluation on the query to detect prompt injections, jailbreaks, and NSFW content
   * using the Hugging Face Serverless Inference API.
   */
  async evaluateSafety(query: string): Promise<SafetyCheckResult> {
    try {
      const [pgResults, toxicResults] = await Promise.all([
        this.queryHFModel(SAFETY_CONFIG.ADVERSARIAL_MODEL, query),
        this.queryHFModel(SAFETY_CONFIG.TOXIC_MODEL, query)
      ]);

      // Hugging Face text classification returns: [[{label: string, score: number}, ...]]
      const pgList = Array.isArray(pgResults) && Array.isArray(pgResults[0]) ? pgResults[0] : [];
      const toxicList = Array.isArray(toxicResults) && Array.isArray(toxicResults[0]) ? toxicResults[0] : [];

      // Evaluate Prompt Guard results (ProtectAI)
      const pgInjection = pgList.find((item: any) => item.label === 'INJECTION');
      const isAdversarial = pgInjection ? pgInjection.score > 0.5 : false;

      // Evaluate Toxic BERT results (obscene score maps to NSFW)
      const toxicObscene = toxicList.find((item: any) => item.label === 'obscene');
      const isNsfw = toxicObscene ? toxicObscene.score > 0.5 : false;

      // Any other main toxicity indicators
      const toxicMain = toxicList.find((item: any) => 
        ['toxic', 'severe_toxic', 'threat', 'identity_hate'].includes(item.label) && item.score > 0.5
      );
      const isToxic = !!toxicMain;

      const isSafe = !isAdversarial && !isNsfw && !isToxic;

      return {
        isSafe,
        checks: {
          adversarial: { 
            flag: isAdversarial, 
            label: pgInjection?.label || 'SAFE', 
            score: pgInjection?.score || 0 
          },
          nsfw: { 
            flag: isNsfw, 
            label: toxicObscene?.label || 'obscene', 
            score: toxicObscene?.score || 0 
          },
          toxic: { 
            flag: isToxic, 
            label: toxicMain?.label || 'none', 
            score: toxicMain?.score || 0 
          }
        }
      };
    } catch (error) {
      console.warn("[Guardrail Error] Safety API check failed, defaulting to safe:", error);
      return {
        isSafe: true, // Default to safe if API is down or throttled
        checks: {
          adversarial: { flag: false, label: 'error', score: 0 },
          nsfw: { flag: false, label: 'error', score: 0 },
          toxic: { flag: false, label: 'error', score: 0 }
        }
      };
    }
  }
}
