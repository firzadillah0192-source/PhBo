"""Backend-owned Advanced experience presets.

The browser receives only safe discovery metadata; prompts and provider
configuration remain server-side.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ExperienceDefinition:
    id: str
    name: str
    description: str
    thumbnail: str | None
    enabled: bool
    status: str
    provider: str
    model: str
    prompt: str
    reference_mode: str
    output_format: str


_EXPERIENCE_ROWS = [
    ('mini-me', 'Mini Me', 'Add multiple tiny animated versions of the same person into the original photo scene.', "Add multiple tiny animated versions of the same person into the original photo scene; make them interact with nearby objects using realistic scale, depth, contact shadows, and matching light while preserving the person's main pose and environment."),
    ('sketch', 'Sketch', 'Turn the uploaded photo into a refined hand-drawn graphite and ink sketch.', "Turn the uploaded photo into a refined hand-drawn graphite and ink sketch; preserve the subject's identity, pose, silhouette, and scene composition with expressive line weight and paper texture."),
    ('80s-flashback', '80s Flashback', 'Reimagine the photo as an authentic 1980s snapshot with direct flash, period color cast, film grain, wardrobe cues, and retro atmosphere while preserving the subject and pose.', 'Reimagine the photo as an authentic 1980s snapshot with direct flash, period color cast, film grain, wardrobe cues, and retro atmosphere while preserving the subject and pose.'),
    ('stickers', 'Stickers', 'Convert the subject and key scene elements into a cohesive sheet of playful die-cut stickers with bold outlines, clean shapes, and expressive details while retaining recognizable identity.', 'Convert the subject and key scene elements into a cohesive sheet of playful die-cut stickers with bold outlines, clean shapes, and expressive details while retaining recognizable identity.'),
    ('create-a-caricature', 'Create a Caricature', "Create a polished editorial caricature that gently exaggerates the subject's recognizable features and expression while preserving identity, pose, and the original context.", "Create a polished editorial caricature that gently exaggerates the subject's recognizable features and expression while preserving identity, pose, and the original context."),
    ('anime', 'Anime', 'Transform the subject into a polished anime illustration with expressive eyes, clean cel shading, and designed background while preserving recognizable pose, clothing silhouette, and composition.', 'Transform the subject into a polished anime illustration with expressive eyes, clean cel shading, and designed background while preserving recognizable pose, clothing silhouette, and composition.'),
    ('underwater', 'Underwater', 'Place the subject in a believable underwater scene with caustic light, suspended particles, fabric movement, and blue-green depth while preserving identity and pose.', 'Place the subject in a believable underwater scene with caustic light, suspended particles, fabric movement, and blue-green depth while preserving identity and pose.'),
    ('pin-collection', 'Pin Collection', 'Render the subject as a premium enamel pin collection with several coordinated pin variants, metal edging, hard enamel highlights, and a clean collector-card layout.', 'Render the subject as a premium enamel pin collection with several coordinated pin variants, metal edging, hard enamel highlights, and a clean collector-card layout.'),
    ('handwritten-style', 'Handwritten Style', "Turn the composition into a warm handwritten journal page with illustrated subject details, natural ink variation, paper texture, and legible decorative notes without changing the subject's identity.", "Turn the composition into a warm handwritten journal page with illustrated subject details, natural ink variation, paper texture, and legible decorative notes without changing the subject's identity."),
    ('interior-design', 'Interior Design', 'Reimagine the surrounding scene as a professionally designed interior while keeping the person as the focal subject, preserving pose, identity, and believable scale.', 'Reimagine the surrounding scene as a professionally designed interior while keeping the person as the focal subject, preserving pose, identity, and believable scale.'),
    ('disco-mode', 'Disco Mode', "Transform the scene into a vivid disco dance floor with mirrored reflections, colored spotlights, energetic atmosphere, and period styling while preserving the subject's recognizable identity.", "Transform the scene into a vivid disco dance floor with mirrored reflections, colored spotlights, energetic atmosphere, and period styling while preserving the subject's recognizable identity."),
    ('app-design', 'App Design', 'Convert the photo into a polished mobile app concept screen with the subject as the hero visual, intentional UI framing, and a coherent product-design composition without obscuring identity.', 'Convert the photo into a polished mobile app concept screen with the subject as the hero visual, intentional UI framing, and a coherent product-design composition without obscuring identity.'),
    ('3d-avatar', '3D Avatar', 'Create a high-quality stylized 3D avatar of the subject with believable materials, soft studio lighting, recognizable facial structure, and the original pose translated into a friendly render.', 'Create a high-quality stylized 3D avatar of the subject with believable materials, soft studio lighting, recognizable facial structure, and the original pose translated into a friendly render.'),
    ('icon-designs', 'Icon Designs', "Create a coordinated set of clean vector-like icons derived from the subject's appearance and pose, with consistent geometry, palette, and recognizable visual traits.", "Create a coordinated set of clean vector-like icons derived from the subject's appearance and pose, with consistent geometry, palette, and recognizable visual traits."),
    ('fix-lighting', 'Fix Lighting', 'Preserve the subject, identity, composition, and environment while improving exposure, lighting direction, skin rendering, white balance, contrast, and color balance without unnecessary scene changes.', 'Preserve the subject, identity, composition, and environment while improving exposure, lighting direction, skin rendering, white balance, contrast, and color balance without unnecessary scene changes.'),
    ('studio-headshot', 'Studio Headshot', 'Create a polished professional studio headshot from the uploaded subject with controlled softbox lighting, natural skin detail, neutral background, and preserved identity and expression.', 'Create a polished professional studio headshot from the uploaded subject with controlled softbox lighting, natural skin detail, neutral background, and preserved identity and expression.'),
    ('chibi-stickers', 'Chibi Stickers', 'Create a set of cute chibi sticker variations of the subject with oversized expressive proportions, consistent outfit cues, thick outlines, and recognizable identity.', 'Create a set of cute chibi sticker variations of the subject with oversized expressive proportions, consistent outfit cues, thick outlines, and recognizable identity.'),
    ('cross-section', 'Cross Section', 'Create a clean educational cross-section illustration of the subject or main object, revealing meaningful internal layers with labeled visual structure while keeping the subject recognizable.', 'Create a clean educational cross-section illustration of the subject or main object, revealing meaningful internal layers with labeled visual structure while keeping the subject recognizable.'),
    ('animal-infographic', 'Animal Infographic', 'Turn the subject into a friendly educational animal-themed infographic with clear visual callouts, accurate readable hierarchy, and a strong resemblance to the uploaded subject.', 'Turn the subject into a friendly educational animal-themed infographic with clear visual callouts, accurate readable hierarchy, and a strong resemblance to the uploaded subject.'),
    ('makeup-guide', 'Makeup Guide', "Create a step-by-step professional makeup guide based on the subject's face, showing flattering application zones and before-to-after stages while preserving identity and facial structure.", "Create a step-by-step professional makeup guide based on the subject's face, showing flattering application zones and before-to-after stages while preserving identity and facial structure."),
    ('enhance-photos', 'Enhance Photos', 'Restore and enhance the uploaded photo with natural detail, balanced exposure, improved color, controlled noise, and realistic sharpness without changing identity or composition.', 'Restore and enhance the uploaded photo with natural detail, balanced exposure, improved color, controlled noise, and realistic sharpness without changing identity or composition.'),
    ('wanderlust', 'Wanderlust', 'Place the subject in an aspirational travel destination scene with natural atmospheric perspective, believable local light, and environmental details while preserving recognizable identity and pose.', 'Place the subject in an aspirational travel destination scene with natural atmospheric perspective, believable local light, and environmental details while preserving recognizable identity and pose.'),
    ('research-visual', 'Research Visual', 'Turn the subject and scene into a clear editorial research visual with diagrams, evidence-style callouts, and disciplined layout while keeping the main subject recognizable.', 'Turn the subject and scene into a clear editorial research visual with diagrams, evidence-style callouts, and disciplined layout while keeping the main subject recognizable.'),
    ('scribble', 'Scribble', 'Transform the photo into a lively spontaneous scribble drawing with layered marker strokes, playful annotations, and preserved subject silhouette and expression.', 'Transform the photo into a lively spontaneous scribble drawing with layered marker strokes, playful annotations, and preserved subject silhouette and expression.'),
    ('illustrated-recipes', 'Illustrated Recipes', 'Turn the subject or food in the photo into a warm illustrated recipe card with hand-painted ingredients, step visuals, and an editorial kitchen mood while retaining recognizable content.', 'Turn the subject or food in the photo into a warm illustrated recipe card with hand-painted ingredients, step visuals, and an editorial kitchen mood while retaining recognizable content.'),
    ('blueprint-poster', 'Blueprint Poster', 'Render the subject or object as a technical blueprint poster with cyan drafting lines, measured callouts, grid structure, and preserved recognizable geometry.', 'Render the subject or object as a technical blueprint poster with cyan drafting lines, measured callouts, grid structure, and preserved recognizable geometry.'),
    ('color-analysis', 'Color Analysis', 'Create a refined personal color-analysis board around the subject with seasonal palette swatches, flattering fabric tones, and editorial styling while preserving identity and face.', 'Create a refined personal color-analysis board around the subject with seasonal palette swatches, flattering fabric tones, and editorial styling while preserving identity and face.'),
    ('nighttime-flash', 'Nighttime Flash', 'Recreate the photo as an authentic nighttime direct-flash snapshot with deep ambient darkness, sharp foreground detail, natural flash falloff, and the same recognizable subject.', 'Recreate the photo as an authentic nighttime direct-flash snapshot with deep ambient darkness, sharp foreground detail, natural flash falloff, and the same recognizable subject.'),
    ('comic', 'Comic', 'Transform the subject into a finished comic-book panel with strong ink contours, purposeful color, cinematic framing, and preserved identity, pose, and scene intent.', 'Transform the subject into a finished comic-book panel with strong ink contours, purposeful color, cinematic framing, and preserved identity, pose, and scene intent.'),
    ('anime-comic', 'Anime Comic', "Create a dynamic anime-comic panel with expressive linework, speed accents, cel shading, and coherent storytelling while preserving the subject's identity and pose.", "Create a dynamic anime-comic panel with expressive linework, speed accents, cel shading, and coherent storytelling while preserving the subject's identity and pose."),
    ('fantasy-newspaper', 'Fantasy Newspaper', 'Design a richly illustrated fantasy newspaper front page featuring the subject as the central story, with period typography and worldbuilding details while keeping identity recognizable.', 'Design a richly illustrated fantasy newspaper front page featuring the subject as the central story, with period typography and worldbuilding details while keeping identity recognizable.'),
    ('bobblehead', 'Bobblehead', 'Create a collectible bobblehead figure of the subject with an oversized head, molded materials, miniature body, display base, and recognizable facial features.', 'Create a collectible bobblehead figure of the subject with an oversized head, molded materials, miniature body, display base, and recognizable facial features.'),
    ('infographic-poster', 'Infographic Poster', 'Turn the subject and key information into a polished infographic poster with clear hierarchy, visual statistics, and a coherent composition that keeps the subject recognizable.', 'Turn the subject and key information into a polished infographic poster with clear hierarchy, visual statistics, and a coherent composition that keeps the subject recognizable.'),
    ('improve-your-desk-setup', 'Improve Your Desk Setup', 'Redesign the desk environment into an ergonomic, aesthetically coherent setup while preserving the person, their pose, and realistic spatial relationships.', 'Redesign the desk environment into an ergonomic, aesthetically coherent setup while preserving the person, their pose, and realistic spatial relationships.'),
    ('film-strip', 'Film Strip', "Create a cinematic film-strip contact sheet with several moments from the subject's scene, consistent lighting, sprocket framing, and preserved identity across frames.", "Create a cinematic film-strip contact sheet with several moments from the subject's scene, consistent lighting, sprocket framing, and preserved identity across frames."),
    ('tarot-card', 'Tarot Card', 'Design an ornate tarot card featuring the subject as the central archetype, with symbolic motifs, border ornament, and dramatic lighting while preserving recognizable identity.', 'Design an ornate tarot card featuring the subject as the central archetype, with symbolic motifs, border ornament, and dramatic lighting while preserving recognizable identity.'),
    ('drawing', 'Drawing', 'Turn the uploaded photo into a carefully observed finished drawing with visible medium texture, accurate proportions, deliberate composition, and preserved identity.', 'Turn the uploaded photo into a carefully observed finished drawing with visible medium texture, accurate proportions, deliberate composition, and preserved identity.'),
    ('hyperreal-wallpaper', 'Hyperreal Wallpaper', 'Create a high-resolution hyperreal editorial wallpaper based on the subject and environment, with dramatic depth and detail while keeping the subject recognizable.', 'Create a high-resolution hyperreal editorial wallpaper based on the subject and environment, with dramatic depth and detail while keeping the subject recognizable.'),
    ('8-bit-game', '8-bit Game', 'Convert the subject into a coherent 8-bit game sprite scene with pixel-perfect clusters, readable silhouette, limited palette, and recognizable clothing and pose.', 'Convert the subject into a coherent 8-bit game sprite scene with pixel-perfect clusters, readable silhouette, limited palette, and recognizable clothing and pose.'),
    ('football-figurine', 'Football Figurine', 'Create a detailed collectible football figurine of the subject in a dynamic kit and stance, with molded texture, base, and recognizable facial likeness.', 'Create a detailed collectible football figurine of the subject in a dynamic kit and stance, with molded texture, base, and recognizable facial likeness.'),
    ('landscape', 'Landscape', 'Place the subject naturally within a cinematic landscape that supports scale and atmosphere, preserving identity, pose, and believable environmental lighting.', 'Place the subject naturally within a cinematic landscape that supports scale and atmosphere, preserving identity, pose, and believable environmental lighting.'),
    ('statue', 'Statue', 'Transform the subject into a museum-quality statue with believable stone or metal material, sculpted detail, gallery lighting, and preserved facial identity.', 'Transform the subject into a museum-quality statue with believable stone or metal material, sculpted detail, gallery lighting, and preserved facial identity.'),
    ('hairstyles', 'Hairstyles', 'Create a clean comparison board showing several plausible hairstyle variations on the same subject while preserving face, identity, lighting, and consistent framing.', 'Create a clean comparison board showing several plausible hairstyle variations on the same subject while preserving face, identity, lighting, and consistent framing.'),
    ('palm-reading', 'Palm Reading', "Create a tasteful illustrated palm-reading consultation scene centered on the subject's hand and identity, with clear symbolic markings and warm atmospheric detail.", "Create a tasteful illustrated palm-reading consultation scene centered on the subject's hand and identity, with clear symbolic markings and warm atmospheric detail."),
]


def _build_registry() -> dict[str, ExperienceDefinition]:
    return {
        eid: ExperienceDefinition(
            id=eid,
            name=name,
            description=description,
            thumbnail=None,
            enabled=True,
            status="ACTIVE",
            provider="9router",
            model="cx/gpt-image-2.5",
            prompt=(
                f"{prompt} Use only the single supplied user photo as reference. "
                "Do not perform a literal face swap, do not invent an unrelated person, "
                "do not add text or watermark, and output a polished PNG."
            ),
            reference_mode="SINGLE_USER_IMAGE",
            output_format="PNG",
        )
        for eid, name, description, prompt in _EXPERIENCE_ROWS
    }


_PRESETS = _build_registry()


def list_experiences() -> list[ExperienceDefinition]:
    return [_PRESETS[key] for key in sorted(_PRESETS)]


def get_experience(experience_id: str) -> ExperienceDefinition:
    try:
        return _PRESETS[experience_id]
    except KeyError as exc:
        raise KeyError(f"experience not found: {experience_id}") from exc
