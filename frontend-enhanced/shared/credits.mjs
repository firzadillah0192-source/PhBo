// Current wallet contract: start thresholds are not AI price estimates.
export function minimumCredits(mode) { return String(mode).toUpperCase() === 'CLASSIC' ? 1 : 10 }
export function canStart(mode, balance) { return Number.isFinite(balance) && balance >= minimumCredits(mode) }
export function creditDescription(mode) { return String(mode).toUpperCase() === 'CLASSIC' ? '1 credit per successful result. Failed jobs do not spend credits.' : 'Requires at least 10 credits to start. Final cost is calculated after success; failed jobs do not spend credits.' }
