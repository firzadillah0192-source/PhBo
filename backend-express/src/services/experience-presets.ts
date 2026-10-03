// Imported from PhBo/backend/app/experiences.py. Server-only prompts.
import type { ExperiencePreset } from './ninerouter.service.js';
export const experiencePresets: readonly ExperiencePreset[] = [
  {
    "id": "mini-me",
    "name": "Mini Me",
    "description": "Add multiple tiny animated versions of the same person into the original photo scene.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Add multiple tiny animated versions of the same person into the original photo scene; make them interact with nearby objects using realistic scale, depth, contact shadows, and matching light while preserving the person's main pose and environment. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "sketch",
    "name": "Sketch",
    "description": "Turn the uploaded photo into a refined hand-drawn graphite and ink sketch.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Turn the uploaded photo into a refined hand-drawn graphite and ink sketch; preserve the subject's identity, pose, silhouette, and scene composition with expressive line weight and paper texture. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "80s-flashback",
    "name": "80s Flashback",
    "description": "Reimagine the photo as an authentic 1980s snapshot with direct flash, period color cast, film grain, wardrobe cues, and retro atmosphere while preserving the subject and pose.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Reimagine the photo as an authentic 1980s snapshot with direct flash, period color cast, film grain, wardrobe cues, and retro atmosphere while preserving the subject and pose. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "stickers",
    "name": "Stickers",
    "description": "Convert the subject and key scene elements into a cohesive sheet of playful die-cut stickers with bold outlines, clean shapes, and expressive details while retaining recognizable identity.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Convert the subject and key scene elements into a cohesive sheet of playful die-cut stickers with bold outlines, clean shapes, and expressive details while retaining recognizable identity. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "create-a-caricature",
    "name": "Create a Caricature",
    "description": "Create a polished editorial caricature that gently exaggerates the subject's recognizable features and expression while preserving identity, pose, and the original context.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Create a polished editorial caricature that gently exaggerates the subject's recognizable features and expression while preserving identity, pose, and the original context. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "anime",
    "name": "Anime",
    "description": "Transform the subject into a polished anime illustration with expressive eyes, clean cel shading, and designed background while preserving recognizable pose, clothing silhouette, and composition.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Transform the subject into a polished anime illustration with expressive eyes, clean cel shading, and designed background while preserving recognizable pose, clothing silhouette, and composition. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "underwater",
    "name": "Underwater",
    "description": "Place the subject in a believable underwater scene with caustic light, suspended particles, fabric movement, and blue-green depth while preserving identity and pose.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Place the subject in a believable underwater scene with caustic light, suspended particles, fabric movement, and blue-green depth while preserving identity and pose. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "pin-collection",
    "name": "Pin Collection",
    "description": "Render the subject as a premium enamel pin collection with several coordinated pin variants, metal edging, hard enamel highlights, and a clean collector-card layout.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Render the subject as a premium enamel pin collection with several coordinated pin variants, metal edging, hard enamel highlights, and a clean collector-card layout. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "handwritten-style",
    "name": "Handwritten Style",
    "description": "Turn the composition into a warm handwritten journal page with illustrated subject details, natural ink variation, paper texture, and legible decorative notes without changing the subject's identity.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Turn the composition into a warm handwritten journal page with illustrated subject details, natural ink variation, paper texture, and legible decorative notes without changing the subject's identity. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "interior-design",
    "name": "Interior Design",
    "description": "Reimagine the surrounding scene as a professionally designed interior while keeping the person as the focal subject, preserving pose, identity, and believable scale.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Reimagine the surrounding scene as a professionally designed interior while keeping the person as the focal subject, preserving pose, identity, and believable scale. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "disco-mode",
    "name": "Disco Mode",
    "description": "Transform the scene into a vivid disco dance floor with mirrored reflections, colored spotlights, energetic atmosphere, and period styling while preserving the subject's recognizable identity.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Transform the scene into a vivid disco dance floor with mirrored reflections, colored spotlights, energetic atmosphere, and period styling while preserving the subject's recognizable identity. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "app-design",
    "name": "App Design",
    "description": "Convert the photo into a polished mobile app concept screen with the subject as the hero visual, intentional UI framing, and a coherent product-design composition without obscuring identity.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Convert the photo into a polished mobile app concept screen with the subject as the hero visual, intentional UI framing, and a coherent product-design composition without obscuring identity. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "3d-avatar",
    "name": "3D Avatar",
    "description": "Create a high-quality stylized 3D avatar of the subject with believable materials, soft studio lighting, recognizable facial structure, and the original pose translated into a friendly render.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Create a high-quality stylized 3D avatar of the subject with believable materials, soft studio lighting, recognizable facial structure, and the original pose translated into a friendly render. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "icon-designs",
    "name": "Icon Designs",
    "description": "Create a coordinated set of clean vector-like icons derived from the subject's appearance and pose, with consistent geometry, palette, and recognizable visual traits.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Create a coordinated set of clean vector-like icons derived from the subject's appearance and pose, with consistent geometry, palette, and recognizable visual traits. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "fix-lighting",
    "name": "Fix Lighting",
    "description": "Preserve the subject, identity, composition, and environment while improving exposure, lighting direction, skin rendering, white balance, contrast, and color balance without unnecessary scene changes.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Preserve the subject, identity, composition, and environment while improving exposure, lighting direction, skin rendering, white balance, contrast, and color balance without unnecessary scene changes. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "studio-headshot",
    "name": "Studio Headshot",
    "description": "Create a polished professional studio headshot from the uploaded subject with controlled softbox lighting, natural skin detail, neutral background, and preserved identity and expression.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Create a polished professional studio headshot from the uploaded subject with controlled softbox lighting, natural skin detail, neutral background, and preserved identity and expression. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "chibi-stickers",
    "name": "Chibi Stickers",
    "description": "Create a set of cute chibi sticker variations of the subject with oversized expressive proportions, consistent outfit cues, thick outlines, and recognizable identity.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Create a set of cute chibi sticker variations of the subject with oversized expressive proportions, consistent outfit cues, thick outlines, and recognizable identity. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "cross-section",
    "name": "Cross Section",
    "description": "Create a clean educational cross-section illustration of the subject or main object, revealing meaningful internal layers with labeled visual structure while keeping the subject recognizable.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Create a clean educational cross-section illustration of the subject or main object, revealing meaningful internal layers with labeled visual structure while keeping the subject recognizable. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "animal-infographic",
    "name": "Animal Infographic",
    "description": "Turn the subject into a friendly educational animal-themed infographic with clear visual callouts, accurate readable hierarchy, and a strong resemblance to the uploaded subject.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Turn the subject into a friendly educational animal-themed infographic with clear visual callouts, accurate readable hierarchy, and a strong resemblance to the uploaded subject. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "makeup-guide",
    "name": "Makeup Guide",
    "description": "Create a step-by-step professional makeup guide based on the subject's face, showing flattering application zones and before-to-after stages while preserving identity and facial structure.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Create a step-by-step professional makeup guide based on the subject's face, showing flattering application zones and before-to-after stages while preserving identity and facial structure. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "enhance-photos",
    "name": "Enhance Photos",
    "description": "Restore and enhance the uploaded photo with natural detail, balanced exposure, improved color, controlled noise, and realistic sharpness without changing identity or composition.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Restore and enhance the uploaded photo with natural detail, balanced exposure, improved color, controlled noise, and realistic sharpness without changing identity or composition. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "wanderlust",
    "name": "Wanderlust",
    "description": "Place the subject in an aspirational travel destination scene with natural atmospheric perspective, believable local light, and environmental details while preserving recognizable identity and pose.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Place the subject in an aspirational travel destination scene with natural atmospheric perspective, believable local light, and environmental details while preserving recognizable identity and pose. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "research-visual",
    "name": "Research Visual",
    "description": "Turn the subject and scene into a clear editorial research visual with diagrams, evidence-style callouts, and disciplined layout while keeping the main subject recognizable.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Turn the subject and scene into a clear editorial research visual with diagrams, evidence-style callouts, and disciplined layout while keeping the main subject recognizable. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "scribble",
    "name": "Scribble",
    "description": "Transform the photo into a lively spontaneous scribble drawing with layered marker strokes, playful annotations, and preserved subject silhouette and expression.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Transform the photo into a lively spontaneous scribble drawing with layered marker strokes, playful annotations, and preserved subject silhouette and expression. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "illustrated-recipes",
    "name": "Illustrated Recipes",
    "description": "Turn the subject or food in the photo into a warm illustrated recipe card with hand-painted ingredients, step visuals, and an editorial kitchen mood while retaining recognizable content.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Turn the subject or food in the photo into a warm illustrated recipe card with hand-painted ingredients, step visuals, and an editorial kitchen mood while retaining recognizable content. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "blueprint-poster",
    "name": "Blueprint Poster",
    "description": "Render the subject or object as a technical blueprint poster with cyan drafting lines, measured callouts, grid structure, and preserved recognizable geometry.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Render the subject or object as a technical blueprint poster with cyan drafting lines, measured callouts, grid structure, and preserved recognizable geometry. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "color-analysis",
    "name": "Color Analysis",
    "description": "Create a refined personal color-analysis board around the subject with seasonal palette swatches, flattering fabric tones, and editorial styling while preserving identity and face.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Create a refined personal color-analysis board around the subject with seasonal palette swatches, flattering fabric tones, and editorial styling while preserving identity and face. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "nighttime-flash",
    "name": "Nighttime Flash",
    "description": "Recreate the photo as an authentic nighttime direct-flash snapshot with deep ambient darkness, sharp foreground detail, natural flash falloff, and the same recognizable subject.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Recreate the photo as an authentic nighttime direct-flash snapshot with deep ambient darkness, sharp foreground detail, natural flash falloff, and the same recognizable subject. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "comic",
    "name": "Comic",
    "description": "Transform the subject into a finished comic-book panel with strong ink contours, purposeful color, cinematic framing, and preserved identity, pose, and scene intent.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Transform the subject into a finished comic-book panel with strong ink contours, purposeful color, cinematic framing, and preserved identity, pose, and scene intent. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "anime-comic",
    "name": "Anime Comic",
    "description": "Create a dynamic anime-comic panel with expressive linework, speed accents, cel shading, and coherent storytelling while preserving the subject's identity and pose.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Create a dynamic anime-comic panel with expressive linework, speed accents, cel shading, and coherent storytelling while preserving the subject's identity and pose. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "fantasy-newspaper",
    "name": "Fantasy Newspaper",
    "description": "Design a richly illustrated fantasy newspaper front page featuring the subject as the central story, with period typography and worldbuilding details while keeping identity recognizable.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Design a richly illustrated fantasy newspaper front page featuring the subject as the central story, with period typography and worldbuilding details while keeping identity recognizable. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "bobblehead",
    "name": "Bobblehead",
    "description": "Create a collectible bobblehead figure of the subject with an oversized head, molded materials, miniature body, display base, and recognizable facial features.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Create a collectible bobblehead figure of the subject with an oversized head, molded materials, miniature body, display base, and recognizable facial features. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "infographic-poster",
    "name": "Infographic Poster",
    "description": "Turn the subject and key information into a polished infographic poster with clear hierarchy, visual statistics, and a coherent composition that keeps the subject recognizable.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Turn the subject and key information into a polished infographic poster with clear hierarchy, visual statistics, and a coherent composition that keeps the subject recognizable. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "improve-your-desk-setup",
    "name": "Improve Your Desk Setup",
    "description": "Redesign the desk environment into an ergonomic, aesthetically coherent setup while preserving the person, their pose, and realistic spatial relationships.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Redesign the desk environment into an ergonomic, aesthetically coherent setup while preserving the person, their pose, and realistic spatial relationships. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "film-strip",
    "name": "Film Strip",
    "description": "Create a cinematic film-strip contact sheet with several moments from the subject's scene, consistent lighting, sprocket framing, and preserved identity across frames.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Create a cinematic film-strip contact sheet with several moments from the subject's scene, consistent lighting, sprocket framing, and preserved identity across frames. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "tarot-card",
    "name": "Tarot Card",
    "description": "Design an ornate tarot card featuring the subject as the central archetype, with symbolic motifs, border ornament, and dramatic lighting while preserving recognizable identity.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Design an ornate tarot card featuring the subject as the central archetype, with symbolic motifs, border ornament, and dramatic lighting while preserving recognizable identity. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "drawing",
    "name": "Drawing",
    "description": "Turn the uploaded photo into a carefully observed finished drawing with visible medium texture, accurate proportions, deliberate composition, and preserved identity.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Turn the uploaded photo into a carefully observed finished drawing with visible medium texture, accurate proportions, deliberate composition, and preserved identity. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "hyperreal-wallpaper",
    "name": "Hyperreal Wallpaper",
    "description": "Create a high-resolution hyperreal editorial wallpaper based on the subject and environment, with dramatic depth and detail while keeping the subject recognizable.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Create a high-resolution hyperreal editorial wallpaper based on the subject and environment, with dramatic depth and detail while keeping the subject recognizable. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "8-bit-game",
    "name": "8-bit Game",
    "description": "Convert the subject into a coherent 8-bit game sprite scene with pixel-perfect clusters, readable silhouette, limited palette, and recognizable clothing and pose.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Convert the subject into a coherent 8-bit game sprite scene with pixel-perfect clusters, readable silhouette, limited palette, and recognizable clothing and pose. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "football-figurine",
    "name": "Football Figurine",
    "description": "Create a detailed collectible football figurine of the subject in a dynamic kit and stance, with molded texture, base, and recognizable facial likeness.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Create a detailed collectible football figurine of the subject in a dynamic kit and stance, with molded texture, base, and recognizable facial likeness. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "landscape",
    "name": "Landscape",
    "description": "Place the subject naturally within a cinematic landscape that supports scale and atmosphere, preserving identity, pose, and believable environmental lighting.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Place the subject naturally within a cinematic landscape that supports scale and atmosphere, preserving identity, pose, and believable environmental lighting. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "statue",
    "name": "Statue",
    "description": "Transform the subject into a museum-quality statue with believable stone or metal material, sculpted detail, gallery lighting, and preserved facial identity.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Transform the subject into a museum-quality statue with believable stone or metal material, sculpted detail, gallery lighting, and preserved facial identity. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "hairstyles",
    "name": "Hairstyles",
    "description": "Create a clean comparison board showing several plausible hairstyle variations on the same subject while preserving face, identity, lighting, and consistent framing.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Create a clean comparison board showing several plausible hairstyle variations on the same subject while preserving face, identity, lighting, and consistent framing. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  },
  {
    "id": "palm-reading",
    "name": "Palm Reading",
    "description": "Create a tasteful illustrated palm-reading consultation scene centered on the subject's hand and identity, with clear symbolic markings and warm atmospheric detail.",
    "model": "cx/gpt-image-2.5",
    "prompt": "Create a tasteful illustrated palm-reading consultation scene centered on the subject's hand and identity, with clear symbolic markings and warm atmospheric detail. Use only the single supplied user photo as reference. Do not perform a literal face swap, do not invent an unrelated person, do not add text or watermark, and output a polished PNG."
  }
];
