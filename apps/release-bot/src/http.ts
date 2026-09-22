/**
 * Shared fetch concerns.
 *
 * Node's fetch has no default timeout, and this runs as a cron container with a
 * restart policy of NEVER: one hung socket would leave the run alive until a
 * later scheduled run overlapped it, and two concurrent runs reading the same
 * channel can both decide the same release is unannounced.
 */

export const TIMEOUT_MS = 20_000;

/** Parses a JSON body, naming the service when the body turns out not to be JSON. */
export async function parseJson<T>(res: Response, what: string): Promise<T> {
    const text = await res.text();
    try {
        return JSON.parse(text) as T;
    } catch (cause) {
        throw new Error(`${what} returned a non-JSON body: ${text.slice(0, 200)}`, { cause });
    }
}
