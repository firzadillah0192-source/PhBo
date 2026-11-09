import React, { useState } from 'react';
import { ArrowLeft, Check, Sparkles, Filter } from 'lucide-react';
import { StudioTemplate } from '../types';
import { STUDIO_TEMPLATES } from '../data/templates';

interface BasicGalleryProps {
  onSelectTemplate: (template: StudioTemplate) => void;
  onBackToHome: () => void;
}

export const BasicGallery: React.FC<BasicGalleryProps> = ({
  onSelectTemplate,
  onBackToHome,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const categories = ['All', 'Studio', 'Film', 'Monochrome', 'Colorway'];

  const filtered = selectedCategory === 'All'
    ? STUDIO_TEMPLATES
    : STUDIO_TEMPLATES.filter((t) => t.category === selectedCategory);

  const handlePick = (template: StudioTemplate) => {
    setSelectedId(template.id);
    setTimeout(() => {
      onSelectTemplate(template);
    }, 350);
  };

  return (
    <div className="min-h-screen pt-24 pb-28 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto select-none">
      
      {/* TOP BAR / BREADCRUMB */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
        <div>
          <button
            id="basic-back-btn"
            onClick={onBackToHome}
            className="group inline-flex items-center gap-2 text-xs font-semibold text-[#787B86] hover:text-[#111216] uppercase tracking-wider mb-3 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-1 transition-transform" />
            <span>Return to Celestial Studio</span>
          </button>
          
          <h2 className="font-editorial text-4xl sm:text-5xl lg:text-6xl text-[#111216] font-normal tracking-tight">
            Choose your studio.
          </h2>
          <p className="font-sans-clean text-[#6B7280] text-sm sm:text-base mt-2 max-w-lg">
            Curated lighting, chemistry, and print formats. Fast, predictable, and calibrated for timeless portraits.
          </p>
        </div>

        {/* CATEGORY FILTER PILLS */}
        <div className="flex items-center gap-1.5 p-1 rounded-full bg-white/80 backdrop-blur-md border border-[#E8E8E5] self-start sm:self-auto overflow-x-auto max-w-full">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium tracking-wide transition-all ${
                selectedCategory === cat
                  ? 'bg-[#111216] text-white shadow-xs'
                  : 'text-[#4B5563] hover:text-[#111216] hover:bg-[#EEF2F5]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* TEMPLATE GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
        {filtered.map((template) => {
          const isChosen = selectedId === template.id;

          return (
            <div
              key={template.id}
              id={`template-card-${template.id}`}
              onClick={() => handlePick(template)}
              className={`group relative rounded-2xl bg-white/90 backdrop-blur-md border transition-all duration-500 overflow-hidden cursor-pointer flex flex-col ${
                isChosen
                  ? 'border-[#111216] ring-4 ring-[#111216]/10 scale-[1.02] shadow-[0_24px_50px_rgba(0,0,0,0.12)]'
                  : 'border-[#E8E8E5] hover:border-[#111216]/40 hover:shadow-[0_20px_40px_rgba(0,0,0,0.06)] hover:-translate-y-1'
              }`}
            >
              {/* IMAGE STAGE */}
              <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#EEF2F5]">
                <img
                  src={template.previewImage}
                  alt={template.title}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  loading="lazy"
                />

                {/* Subtle lighting overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#111216]/80 via-transparent to-transparent opacity-50 group-hover:opacity-30 transition-opacity" />

                {/* Badges */}
                <div className="absolute top-4 left-4 flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md text-[10px] uppercase font-semibold tracking-wider text-white">
                    {template.category}
                  </span>
                  <span className="px-2 py-1 rounded-full bg-white/70 backdrop-blur-md text-[10px] uppercase font-mono tracking-wider text-[#111216]">
                    {template.aspectRatio}
                  </span>
                </div>

                {/* Frame Style Tag */}
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-white">
                  <span className="text-xs uppercase font-medium tracking-wider drop-shadow-sm opacity-90">
                    {template.frameStyle.replace('-', ' ')}
                  </span>
                  <span className="text-xs font-medium tracking-wide flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                    Select Studio ↗
                  </span>
                </div>
              </div>

              {/* CARD DETAILS */}
              <div className="p-5 flex-1 flex flex-col justify-between bg-white/95">
                <div>
                  <h3 className="font-editorial text-2xl text-[#111216] mb-1 font-normal group-hover:text-[#6558FF] transition-colors">
                    {template.title}
                  </h3>
                  <p className="text-xs font-medium text-[#787B86] uppercase tracking-wider mb-2">
                    {template.subtitle}
                  </p>
                  <p className="text-xs text-[#4B5563] leading-relaxed line-clamp-2">
                    {template.description}
                  </p>
                </div>

                <div className="pt-4 mt-4 border-t border-[#F0F0EE] flex items-center justify-between text-xs text-[#6B7280]">
                  <span>Instant Studio Print</span>
                  <span className="font-semibold text-[#111216]">0 Credits</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
};
