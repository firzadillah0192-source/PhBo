const editableStages = new Set(['gallery', 'art-direction', 'photo', 'review'])

// History contains navigation only. Photos and selections stay in the existing session.
export function recordStudioStep(history, mode, from, to) {
  if (!editableStages.has(from) || !editableStages.has(to) || from === to) return
  const steps = [...editableStages]
  if (steps.indexOf(to) < steps.indexOf(from)) {
    if (history.state?.studioMode === mode && history.state?.studioPreviousStage === to) history.back()
    else history.replaceState({ studioMode: mode, studioStage: to }, '')
    return
  }
  history.replaceState({ ...history.state, studioMode: mode, studioStage: from }, '')
  history.pushState({ studioMode: mode, studioStage: to, studioPreviousStage: from }, '')
}

export function restoredStudioStep(state, mode) {
  return state?.studioMode === mode && editableStages.has(state?.studioStage) ? state.studioStage : null
}
