import { AppError } from '../lib/errors.js';

// Preserve the CURRENT application's art direction during the runtime migration.
// Ornaments are camera effects in the current flow and never enter this prompt.
export const STYLE_PRINCIPLE = 'Adapt this frame design language to the visual world of the selected experience so that the frame and generated scene appear intentionally art-directed together.';
export const COMPOSITION_RULES = 'Create one coherent 2:3 vertical print composition. Keep the subject readable, with essential face and body details inside safe margins. Integrate the frame into the scene rather than adding a fixed border. No stretching.';
export const BRANDING_RULES = 'The required footer lettering below is an explicit exception to any earlier instruction forbidding text or watermarks. Fill the branding box or footer within the lower part of the frame with the exact text "NXBooth" and a smaller line underneath reading "Powered by GenNexByte". Integrate both lines into that frame area with clear, legible lettering and materials appropriate to the selected experience. Keep all branding inside the frame\'s footer, without covering the subject. Do not leave the branding box empty, add a separate black panel, duplicate the branding, or add any other text.';

export function composeAdvancedPrompt(experiencePrompt: string, frameStylePrompt: string): string {
  if (!experiencePrompt.trim() || !frameStylePrompt.trim()) throw new AppError(422, 'ADVANCED_SELECTION_INVALID', 'Experience and frame prompts are required');
  return [
    'EXPERIENCE — PRIMARY VISUAL AUTHORITY\n' + experiencePrompt.trim(),
    'FRAME STYLE\n' + frameStylePrompt.trim() + '\n' + STYLE_PRINCIPLE,
    'PRINT AND COMPOSITION\n' + COMPOSITION_RULES,
    'FRAME FOOTER BRANDING\n' + BRANDING_RULES,
  ].join('\n\n');
}

export function composeBasicPrompt(templateName: string, templateDescription: string): string {
  if (!templateName.trim() || !templateDescription.trim()) throw new AppError(422, 'BASIC_TEMPLATE_INVALID', 'Template direction is required');
  return [
    'TEMPLATE — PRIMARY VISUAL DIRECTION\nCreate a polished photobooth portrait inspired by the selected template. Preserve the template\'s defining costume, setting, and art direction while creating a coherent scene.',
    `SELECTED TEMPLATE\nName: ${templateName.trim()}\nDescription: ${templateDescription.trim()}`,
    'SUBJECT IDENTITY\nUse only the supplied user photo as the identity reference. Preserve the person\'s recognizable facial structure, skin tone, age, and expression. Keep the same person as the clear main subject; do not substitute or add another person.',
    'PRINT AND COMPOSITION\n' + COMPOSITION_RULES,
    'FRAME FOOTER BRANDING\n' + BRANDING_RULES,
  ].join('\n\n');
}
