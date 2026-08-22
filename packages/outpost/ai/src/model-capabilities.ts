/**
 * Per-model request-shape capabilities.
 *
 * Every Anthropic call in this package sets a `temperature` while its model is
 * env-overridable (`AI_RESPONSE_MODEL`, `AI_CONFIDENCE_MODEL`,
 * `AI_CLASSIFIER_MODEL`, `AI_SENTIMENT_MODEL`). Anthropic REMOVED the sampling
 * parameters — `temperature`, `top_p`, `top_k` — on Claude Fable 5, Mythos 5,
 * Opus 5, Opus 4.8, Opus 4.7 and Sonnet 5: sending any of them returns
 * `400 invalid_request_error`.
 *
 * That turns a one-line env change into a total, silent outage. Set
 * `AI_RESPONSE_MODEL=claude-opus-5` — an entirely reasonable upgrade — and every
 * `messages.create` in the generator 400s, the generator catches it and returns
 * its fallback, and *"I apologize, but I was unable to generate a response at
 * this time"* is what gets posted publicly to every Discord thread and GitHub
 * issue. The classifier, sentiment and confidence calls each swallow their own
 * 400 and quietly degrade to heuristics. The bot keeps answering; every answer
 * is the apology.
 *
 * See https://github.com/CopilotKit/outpost/issues/149.
 *
 * ## Why an allowlist rather than a list of models to avoid
 *
 * The two directions fail differently, and only one of them fails safely:
 *
 *   - Deny-list ("send temperature unless the model is known to reject it") — a
 *     model released after this file was last touched is unlisted, so we send
 *     the parameter, get a 400, and reproduce exactly the outage above.
 *   - Allowlist ("send temperature only where it is known to be accepted") — an
 *     unlisted model simply doesn't receive it. The request succeeds and runs at
 *     the model's default sampling instead of ours.
 *
 * Omitting the parameter is always accepted by the API; sending it is not. So an
 * unknown model gets the omission, and `onOmitted` reports it rather than
 * letting a silent behaviour change ride along unnoticed.
 */

/**
 * Models that accept `temperature`.
 *
 * Matched as prefixes so dated snapshots (`claude-haiku-4-5-20251001`) resolve
 * with their base model. Everything at Opus 4.7 / Sonnet 5 and later is
 * deliberately absent — those are the models that reject it.
 */
const TEMPERATURE_SUPPORTED_PREFIXES = [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-opus-4-5',
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
    // Claude 4.0 — deprecated, retirement TBD, so still callable today.
    'claude-opus-4-0',
    'claude-sonnet-4-0',
    'claude-3',
    // Deliberately absent though they also accepted a temperature: `claude-2.0`
    // and `claude-2.1` retired 2025-07-21, and `claude-opus-4-1` retired
    // 2026-08-05. A retired model can't be called at all, so listing it here
    // would only imply this file is a model registry, which it isn't.
] as const;

/** True when `model` is known to accept a `temperature`. */
export function supportsTemperature(model: string): boolean {
    return TEMPERATURE_SUPPORTED_PREFIXES.some((prefix) => model.startsWith(prefix));
}

/**
 * The sampling half of a `messages.create` request for `model`.
 *
 * Spread into the request rather than setting `temperature` directly, so the key
 * is absent — not undefined — for models that reject it:
 *
 * ```ts
 * await client.messages.create({
 *     model: this.model,
 *     ...samplingParams(this.model, config.responseTemperature),
 *     messages,
 * });
 * ```
 *
 * `onOmitted` is called when the parameter is dropped, so a model swap that
 * silently changes sampling behaviour leaves a trace. It is not called for
 * models that accept the parameter.
 */
export function samplingParams(
    model: string,
    temperature: number,
    onOmitted: (model: string) => void = defaultOmissionWarning,
): { temperature?: number } {
    if (supportsTemperature(model)) return { temperature };
    onOmitted(model);
    return {};
}

/**
 * Models already warned about, so the notice is once per process per model
 * rather than once per request.
 *
 * Without this, a single env change warns on every analyzed message plus every
 * classify, confidence and generate call — thousands of identical lines a day,
 * which buries the real errors this log is meant to sit beside. The condition is
 * a property of the configured model, not of the request, so once is all the
 * information there is.
 */
const warnedModels = new Set<string>();

function defaultOmissionWarning(model: string): void {
    if (warnedModels.has(model)) return;
    warnedModels.add(model);
    console.warn(
        `[AI] Model "${model}" does not accept a temperature — omitting it. ` +
            `The request runs at the model's default sampling. ` +
            `If this model does accept one, add it to TEMPERATURE_SUPPORTED_PREFIXES ` +
            `in model-capabilities.ts. (Warned once per model per process.)`,
    );
}
