import React from 'react';
import { Camera, Sparkles, ArrowRight, Compass } from 'lucide-react';
import { AppMode } from '../types';

interface HeroSectionProps {
  onSelectMode: (mode: 'basic' | 'advanced') => void;
  onHoverMode: (mode: 'basic' | 'advanced' | null) => void;
  onQuickExploreExperience: (id: string) => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  onSelectMode,
  onHoverMode,
  onQuickExploreExperience,
}) => {
  return (
    <section className="relative min-h-[92vh] flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 pt-20 pb-16 text-center select-none">
      
      {/* FLOATING CURATED PREVIEW GLIMPSE PANELS (2-3 integrated editorial panels) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden max-w-7xl mx-auto">
        
        {/* Left Floating Studio Frame */}
        <div 
          onClick={(e) => {
            e.stopPropagation();
            onSelectMode('basic');
          }}
          className="pointer-events-auto hidden lg:flex flex-col items-start absolute left-6 top-[28%] w-56 p-3 bg-white/70 backdrop-blur-md rounded-2xl border border-[#E8E8E5]/90 shadow-[0_16px_40px_rgba(0,0,0,0.06)] transform -rotate-3 hover:rotate-0 hover:scale-105 transition-all duration-500 cursor-pointer group"
        >
          <div className="w-full aspect-[3/4] rounded-xl overflow-hidden mb-2.5 relative bg-[#EEF2F5]">
            <img
              src="https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=600&q=80"
              alt="Curated Studio Preview"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#111216]/60 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />
            <span className="absolute bottom-2 left-2.5 text-[10px] uppercase font-semibold text-white tracking-widest px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-xs">
              Studio Monochrome
            </span>
          </div>
          <div className="flex items-center justify-between w-full px-1">
            <span className="font-editorial italic text-sm text-[#252830]">Curated Analog</span>
            <span className="text-[10px] text-[#787B86] uppercase tracking-wider group-hover:translate-x-0.5 transition-transform">Explore ↗</span>
          </div>
        </div>

        {/* Right Floating AI World Frame */}
        <div 
          onClick={(e) => {
            e.stopPropagation();
            onQuickExploreExperience('cinematic-hero');
          }}
          className="pointer-events-auto hidden lg:flex flex-col items-start absolute right-8 top-[32%] w-56 p-3 bg-white/70 backdrop-blur-md rounded-2xl border border-[#E8E8E5]/90 shadow-[0_16px_40px_rgba(0,0,0,0.06)] transform rotate-3 hover:rotate-0 hover:scale-105 transition-all duration-500 cursor-pointer group"
        >
          <div className="w-full aspect-[3/4] rounded-xl overflow-hidden mb-2.5 relative bg-[#EEF2F5]">
            <img
              src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80"
              alt="AI World Preview"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#111216]/60 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />
            <span className="absolute bottom-2 left-2.5 text-[10px] uppercase font-semibold text-white tracking-widest px-2 py-0.5 rounded-full bg-[#6558FF]/80 backdrop-blur-xs">
              Cinematic Hero
            </span>
          </div>
          <div className="flex items-center justify-between w-full px-1">
            <span className="font-editorial italic text-sm text-[#252830]">AI Dimension</span>
            <span className="text-[10px] text-[#6558FF] uppercase tracking-wider group-hover:translate-x-0.5 transition-transform">Enter ↗</span>
          </div>
        </div>

      </div>

      {/* CENTRAL HERO EDITORIAL CONTENT */}
      <div className="max-w-3xl mx-auto z-10 relative">
        
        {/* Subtle Brand Eyebrow */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/60 backdrop-blur-md border border-[#E8E8E5] text-[#252830] text-xs uppercase tracking-widest mb-6 shadow-xs animate-fade-in">
          <span className="w-1.5 h-1.5 rounded-full bg-[#6558FF]" />
          <span>The Celestial Digital Studio</span>
        </div>

        {/* Display Headline */}
        <h1 className="font-editorial text-5xl sm:text-7xl lg:text-8xl text-[#111216] font-normal tracking-tight leading-[1.05] sm:leading-[1] mb-6">
          Step into <br />
          <span className="italic font-light text-[#252830]">another version of you.</span>
        </h1>

        {/* Supporting Copy */}
        <p className="font-sans-clean text-[#4B5563] text-base sm:text-lg max-w-xl mx-auto mb-10 leading-relaxed font-normal">
          Choose an archival photographic studio or enter a bespoke AI-powered world. High fashion, cinematic film, and impossible landscapes.
        </p>

        {/* MODE SELECTOR PORTALS (BASIC / ADVANCED) */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 max-w-xl mx-auto w-full">
          
          {/* BASIC MODE PORTAL */}
          <button
            id="hero-select-basic-btn"
            onClick={() => onSelectMode('basic')}
            onMouseEnter={() => onHoverMode('basic')}
            onMouseLeave={() => onHoverMode(null)}
            className="group w-full sm:w-1/2 p-5 sm:p-6 rounded-2xl bg-white/80 backdrop-blur-lg border border-[#E8E8E5] hover:border-[#111216] shadow-[0_8px_30px_rgba(0,0,0,0.03)] hover:shadow-[0_16px_40px_rgba(0,0,0,0.08)] transition-all duration-300 flex flex-col items-start text-left cursor-pointer active:scale-98"
          >
            <div className="w-full flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#F7F7F5] border border-[#E8E8E5] flex items-center justify-center text-[#111216] group-hover:bg-[#111216] group-hover:text-white transition-colors duration-300">
                <Camera className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-semibold text-[#787B86] uppercase tracking-wider group-hover:text-[#111216] transition-colors">
                Fast · Zero Quota
              </span>
            </div>
            <h3 className="font-sans-clean font-semibold text-lg text-[#111216] mb-1">
              Basic Studio
            </h3>
            <p className="text-xs text-[#6B7280] mb-4 leading-relaxed">
              Curated photobooth studio. Silver halide monochrome, warm 35mm filmstrip, and instant prints.
            </p>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#111216] group-hover:translate-x-1 transition-transform">
              <span>Enter Studio</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </button>

          {/* ADVANCED MODE PORTAL */}
          <button
            id="hero-select-advanced-btn"
            onClick={() => onSelectMode('advanced')}
            onMouseEnter={() => onHoverMode('advanced')}
            onMouseLeave={() => onHoverMode(null)}
            className="group w-full sm:w-1/2 p-5 sm:p-6 rounded-2xl bg-gradient-to-b from-white/90 to-[#EEF2F5]/90 backdrop-blur-lg border border-[#9CC8FF]/60 hover:border-[#6558FF] shadow-[0_8px_30px_rgba(101,88,255,0.08)] hover:shadow-[0_16px_45px_rgba(101,88,255,0.18)] transition-all duration-300 flex flex-col items-start text-left cursor-pointer active:scale-98 relative overflow-hidden"
          >
            {/* Soft luminous edge highlight */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-[#9CC8FF]/30 to-transparent rounded-bl-full pointer-events-none" />

            <div className="w-full flex items-center justify-between mb-4 relative z-10">
              <div className="w-10 h-10 rounded-xl bg-[#6558FF] text-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform duration-300">
                <Sparkles className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-semibold text-[#6558FF] uppercase tracking-wider">
                AI Studio
              </span>
            </div>
            <h3 className="font-sans-clean font-semibold text-lg text-[#111216] mb-1 relative z-10">
              AI Creative Worlds
            </h3>
            <p className="text-xs text-[#6B7280] mb-4 leading-relaxed relative z-10">
              Cinematic hero portraits, 3D figurines, high fashion covers, synthwave 80s, and enchanted nature.
            </p>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6558FF] group-hover:translate-x-1 transition-transform relative z-10">
              <span>Explore Worlds</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </button>

        </div>

        {/* Ambient bottom caption */}
        <div className="mt-12 flex items-center justify-center gap-6 text-xs text-[#787B86]">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7FA685]" />
            Kiosk Ready
          </span>
          <span>·</span>
          <span>Webcam & High-Res Upload</span>
          <span>·</span>
          <span>Instant Download</span>
        </div>

      </div>

    </section>
  );
};
