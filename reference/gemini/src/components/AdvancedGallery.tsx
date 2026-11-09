import React, { useState } from 'react';
import { ArrowLeft, Sparkles, ArrowRight, Compass } from 'lucide-react';
import { AIExperience } from '../types';
import { EXPERIENCES } from '../data/experiences';

interface AdvancedGalleryProps {
  onSelectExperience: (experience: AIExperience) => void;
  onBackToHome: () => void;
}

export const AdvancedGallery: React.FC<AdvancedGalleryProps> = ({
  onSelectExperience,
  onBackToHome,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('All');

  const featured = EXPERIENCES.find((e) => e.id === 'cinematic-hero') || EXPERIENCES[0];
  const newWorlds = EXPERIENCES.filter((e) => e.category === 'New Worlds');
  const allOther = EXPERIENCES.filter((e) => e.id !== featured.id);

  const categories = ['All', 'Featured', 'New Worlds', 'Portraits', 'Playful', 'Fantasy', 'Retro'];

  const displayedList = activeTab === 'All' 
    ? EXPERIENCES 
    : EXPERIENCES.filter((e) => e.category === activeTab);

  const handlePick = (exp: AIExperience) => {
    setSelectedId(exp.id);
    setTimeout(() => {
      onSelectExperience(exp);
    }, 400);
  };

  return (
    <div className="min-h-screen pt-24 pb-28 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto select-none">
      
      {/* HEADER BAR */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <button
            id="advanced-back-btn"
            onClick={onBackToHome}
            className="group inline-flex items-center gap-2 text-xs font-semibold text-[#787B86] hover:text-[#111216] uppercase tracking-wider mb-3 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-1 transition-transform" />
            <span>Return to Celestial Studio</span>
          </button>
          
          <h2 className="font-editorial text-4xl sm:text-5xl lg:text-6xl text-[#111216] font-normal tracking-tight">
            Choose your world.
          </h2>
          <p className="font-sans-clean text-[#6B7280] text-sm sm:text-base mt-2 max-w-lg">
            Pick a creative direction and we'll create the rest. Transformed photographs in cinematic light and surreal dimensions.
          </p>
        </div>

        {/* CATEGORY SELECTOR */}
        <div className="flex items-center gap-1.5 p-1 rounded-full bg-white/80 backdrop-blur-md border border-[#E8E8E5] self-start sm:self-auto overflow-x-auto max-w-full">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveTab(cat)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium tracking-wide transition-all whitespace-nowrap ${
                activeTab === cat
                  ? 'bg-[#6558FF] text-white shadow-xs'
                  : 'text-[#4B5563] hover:text-[#111216] hover:bg-[#EEF2F5]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* FEATURED HERO EXPERIENCE (If "All" or "Featured" selected) */}
      {(activeTab === 'All' || activeTab === 'Featured') && (
        <div className="mb-14">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs uppercase font-bold tracking-widest text-[#787B86] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#6558FF] animate-pulse" />
              Featured Masterpiece
            </span>
            <span className="text-xs text-[#6B7280]">1 AI Credit</span>
          </div>

          <div
            id={`experience-featured-${featured.id}`}
            onClick={() => handlePick(featured)}
            className={`group relative rounded-3xl overflow-hidden cursor-pointer border border-[#E8E8E5] bg-white/80 backdrop-blur-md transition-all duration-700 shadow-[0_16px_40px_rgba(101,88,255,0.08)] hover:shadow-[0_24px_60px_rgba(101,88,255,0.18)] ${
              selectedId === featured.id ? 'scale-[1.02] ring-4 ring-[#6558FF]' : 'hover:scale-[1.01]'
            }`}
          >
            <div className="relative aspect-[16/9] sm:aspect-[21/9] w-full overflow-hidden bg-[#EEF2F5]">
              <img
                src={featured.heroImage || featured.previewImage}
                alt={featured.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-1000 ease-out"
                loading="eager"
              />
              
              {/* Cinematic Vignette & Gradient */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#111216]/90 via-[#111216]/30 to-transparent opacity-80 group-hover:opacity-65 transition-opacity" />

              {/* Badges */}
              <div className="absolute top-6 left-6 flex items-center gap-3">
                <span className="px-3 py-1 rounded-full bg-white/80 backdrop-blur-md text-xs font-semibold uppercase tracking-wider text-[#111216]">
                  {featured.badge || 'Featured'}
                </span>
                <span className="px-3 py-1 rounded-full bg-black/40 backdrop-blur-md text-xs font-medium uppercase tracking-wider text-white">
                  {featured.category}
                </span>
              </div>

              {/* Bottom Editorial Content */}
              <div className="absolute bottom-6 left-6 right-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4 text-white">
                <div>
                  <h3 className="font-editorial text-3xl sm:text-5xl lg:text-6xl font-normal tracking-tight mb-2 drop-shadow-sm">
                    {featured.title}
                  </h3>
                  <p className="font-sans-clean text-white/85 text-sm sm:text-base tracking-wide max-w-xl">
                    {featured.tagline} · Anamorphic 35mm golden-hour backlight and volumetric horizon fog.
                  </p>
                </div>

                <div className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white text-[#111216] font-semibold text-xs uppercase tracking-wider group-hover:bg-[#6558FF] group-hover:text-white transition-all shadow-md group-hover:translate-x-1 shrink-0">
                  <span>Enter World</span>
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NEW WORLDS RAIL (If "All" or "New Worlds" selected) */}
      {(activeTab === 'All' || activeTab === 'New Worlds') && (
        <div className="mb-14">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs uppercase font-bold tracking-widest text-[#787B86] flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#6558FF]" />
              New Dimensions
            </span>
            <span className="text-xs text-[#787B86]">Curated Releases</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {newWorlds.map((world) => {
              const isChosen = selectedId === world.id;
              return (
                <div
                  key={world.id}
                  id={`experience-card-${world.id}`}
                  onClick={() => handlePick(world)}
                  className={`group relative rounded-2xl overflow-hidden cursor-pointer bg-white border transition-all duration-500 flex flex-col ${
                    isChosen
                      ? 'border-[#6558FF] ring-4 ring-[#6558FF]/20 scale-[1.02] shadow-[0_20px_45px_rgba(101,88,255,0.18)]'
                      : 'border-[#E8E8E5] hover:border-[#6558FF]/50 hover:shadow-[0_16px_35px_rgba(0,0,0,0.06)] hover:-translate-y-1'
                  }`}
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#EEF2F5]">
                    <img
                      src={world.previewImage}
                      alt={world.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#111216]/80 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />
                    
                    <span className="absolute top-3 right-3 px-2.5 py-0.5 rounded-full bg-black/40 backdrop-blur-md text-[10px] uppercase font-semibold text-white">
                      {world.badge || world.category}
                    </span>

                    <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between text-white">
                      <span className="text-xs font-semibold group-hover:translate-x-1 transition-transform">
                        Select World ↗
                      </span>
                    </div>
                  </div>

                  <div className="p-4 bg-white flex items-center justify-between">
                    <div>
                      <h4 className="font-editorial text-xl text-[#111216] font-normal group-hover:text-[#6558FF] transition-colors">
                        {world.title}
                      </h4>
                      <p className="text-xs text-[#6B7280]">{world.tagline}</p>
                    </div>
                    <span className="text-[11px] font-mono text-[#787B86]">1 CR</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ALL WORLDS EDITORIAL GRID */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs uppercase font-bold tracking-widest text-[#787B86]">
            {activeTab === 'All' ? 'All Creative Worlds' : `${activeTab} Experiences`}
          </span>
          <span className="text-xs text-[#787B86]">80% Imagery · 20% Interface</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {displayedList.map((exp) => {
            const isChosen = selectedId === exp.id;
            return (
              <div
                key={exp.id}
                id={`experience-grid-${exp.id}`}
                onClick={() => handlePick(exp)}
                className={`group relative rounded-2xl overflow-hidden cursor-pointer bg-white border transition-all duration-500 flex flex-col ${
                  isChosen
                    ? 'border-[#6558FF] ring-4 ring-[#6558FF]/20 scale-[1.03] shadow-[0_20px_45px_rgba(101,88,255,0.18)]'
                    : 'border-[#E8E8E5] hover:border-[#6558FF]/40 hover:shadow-[0_16px_35px_rgba(0,0,0,0.06)] hover:-translate-y-1'
                }`}
              >
                {/* 80% IMAGERY */}
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#EEF2F5]">
                  <img
                    src={exp.previewImage}
                    alt={exp.title}
                    className="w-full h-full object-cover group-hover:scale-106 transition-transform duration-700"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#111216]/80 via-transparent to-transparent opacity-50 group-hover:opacity-30 transition-opacity" />

                  {exp.badge && (
                    <span className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full bg-white/80 backdrop-blur-md text-[10px] font-semibold uppercase tracking-wider text-[#111216]">
                      {exp.badge}
                    </span>
                  )}

                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-white">
                    <span className="text-[11px] uppercase tracking-wider text-white/80">
                      {exp.category}
                    </span>
                    <span className="text-xs font-semibold group-hover:translate-x-1 transition-transform">
                      ↗
                    </span>
                  </div>
                </div>

                {/* 20% MINIMAL TEXT */}
                <div className="p-3.5 bg-white flex items-center justify-between">
                  <div className="truncate mr-2">
                    <h4 className="font-editorial text-lg text-[#111216] font-normal truncate group-hover:text-[#6558FF] transition-colors">
                      {exp.title}
                    </h4>
                    <p className="text-[11px] text-[#6B7280] truncate">{exp.tagline}</p>
                  </div>
                  <span className="text-[11px] font-mono text-[#787B86] shrink-0">1 cr</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
};
