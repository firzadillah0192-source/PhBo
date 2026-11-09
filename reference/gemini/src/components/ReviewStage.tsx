import React, { useState } from 'react';
import { ArrowLeft, Sparkles, ArrowRight, Camera, CheckCircle2 } from 'lucide-react';
import { UserPhoto, StudioTemplate, AIExperience, QuotaState } from '../types';

interface ReviewStageProps {
  mode: 'basic' | 'advanced';
  userPhoto: UserPhoto;
  selectedTemplate?: StudioTemplate;
  selectedExperience?: AIExperience;
  quota: QuotaState;
  onStartProcessing: () => void;
  onBackToCapture: () => void;
}

export const ReviewStage: React.FC<ReviewStageProps> = ({
  mode,
  userPhoto,
  selectedTemplate,
  selectedExperience,
  quota,
  onStartProcessing,
  onBackToCapture,
}) => {
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);

  const destinationTitle = mode === 'basic' ? selectedTemplate?.title : selectedExperience?.title;
  const destinationImage = mode === 'basic' ? selectedTemplate?.previewImage : selectedExperience?.previewImage;
  const destinationTagline = mode === 'basic' ? selectedTemplate?.subtitle : selectedExperience?.tagline;

  const handleCreate = () => {
    setIsTransitioning(true);
    setTimeout(() => {
      onStartProcessing();
    }, 750);
  };

  return (
    <div className="min-h-screen pt-24 pb-28 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto select-none">
      
      {/* TOP NAV BAR */}
      <div className="flex items-center justify-between mb-8">
        <button
          id="review-back-btn"
          onClick={onBackToCapture}
          className="group inline-flex items-center gap-2 text-xs font-semibold text-[#787B86] hover:text-[#111216] uppercase tracking-wider transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-1 transition-transform" />
          <span>Change Portrait</span>
        </button>

        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/80 border border-[#E8E8E5] text-xs text-[#252830]">
          <span className="w-2 h-2 rounded-full bg-[#7FA685]" />
          <span>Stage Ready</span>
        </div>
      </div>

      {/* EDITORIAL SPLIT COMPOSITION */}
      <div className="text-center max-w-xl mx-auto mb-10">
        <h2 className="font-editorial text-4xl sm:text-5xl lg:text-6xl text-[#111216] font-normal tracking-tight">
          Convergence.
        </h2>
        <p className="font-sans-clean text-[#6B7280] text-sm sm:text-base mt-2">
          Your portrait meets the {destinationTitle} aesthetic.
        </p>
      </div>

      {/* CONVERGENCE STAGE CONTAINER */}
      <div
        className={`relative grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-12 items-center max-w-4xl mx-auto transition-all duration-700 ${
          isTransitioning ? 'scale-95 opacity-50 blur-xs' : 'scale-100 opacity-100'
        }`}
      >
        
        {/* LEFT: USER PHOTO CARD */}
        <div className="relative group rounded-3xl overflow-hidden bg-white/80 backdrop-blur-md border border-[#E8E8E5] shadow-[0_16px_40px_rgba(0,0,0,0.06)] p-3 flex flex-col">
          <div className="relative aspect-[3/4] w-full rounded-2xl overflow-hidden bg-[#181A20]">
            <img
              src={userPhoto.dataUrl}
              alt="Source Portrait"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
            
            <span className="absolute top-3 left-3 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md text-[10px] uppercase font-semibold text-white tracking-widest">
              Source Portrait
            </span>
          </div>

          <div className="p-4 flex items-center justify-between">
            <span className="font-editorial text-lg text-[#111216]">Your Photograph</span>
            <span className="text-[11px] uppercase tracking-wider text-[#7FA685] font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Verified
            </span>
          </div>
        </div>

        {/* CONNECTING LIGHT EMBLEM (CENTER CONNECTOR) */}
        <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-[#111216] text-white items-center justify-center shadow-lg border-2 border-white">
          <ArrowRight className="w-5 h-5 text-[#9CC8FF] animate-pulse" />
        </div>

        {/* RIGHT: DESTINATION EXPERIENCE CARD */}
        <div className="relative group rounded-3xl overflow-hidden bg-white/80 backdrop-blur-md border border-[#E8E8E5] shadow-[0_16px_40px_rgba(0,0,0,0.06)] p-3 flex flex-col">
          <div className="relative aspect-[3/4] w-full rounded-2xl overflow-hidden bg-[#181A20]">
            {destinationImage && (
              <img
                src={destinationImage}
                alt={destinationTitle}
                className="w-full h-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none" />

            <span className="absolute top-3 left-3 px-3 py-1 rounded-full bg-[#6558FF] text-[10px] uppercase font-semibold text-white tracking-widest">
              Target Style
            </span>

            <div className="absolute bottom-4 left-4 right-4 text-white">
              <h4 className="font-editorial text-2xl font-normal drop-shadow-sm">
                {destinationTitle}
              </h4>
              <p className="text-xs text-white/80 line-clamp-1">{destinationTagline}</p>
            </div>
          </div>

          <div className="p-4 flex items-center justify-between">
            <span className="font-editorial text-lg text-[#111216]">
              {mode === 'basic' ? 'Studio Formulation' : 'AI World Render'}
            </span>
            <span className="text-[11px] uppercase tracking-wider text-[#6558FF] font-semibold">
              {mode === 'basic' ? 'Local Studio' : '1 AI Credit'}
            </span>
          </div>
        </div>

      </div>

      {/* CTA ACTION BUTTON */}
      <div className="mt-12 flex flex-col items-center justify-center">
        <button
          id="review-create-cta-btn"
          onClick={handleCreate}
          disabled={isTransitioning}
          className="group relative px-10 py-4 rounded-full bg-[#111216] text-white hover:bg-[#6558FF] transition-all duration-300 shadow-[0_12px_30px_rgba(0,0,0,0.15)] hover:shadow-[0_16px_40px_rgba(101,88,255,0.3)] hover:scale-105 active:scale-98 cursor-pointer flex items-center gap-3 text-sm font-semibold tracking-wider uppercase"
        >
          {mode === 'advanced' ? (
            <>
              <Sparkles className="w-4 h-4 text-[#F3B587] group-hover:rotate-12 transition-transform" />
              <span>Create with AI · 1 Credit</span>
            </>
          ) : (
            <>
              <Camera className="w-4 h-4 text-[#9CC8FF]" />
              <span>Create Photo · Studio Free</span>
            </>
          )}
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>

        <p className="text-xs text-[#787B86] mt-4">
          {mode === 'advanced'
            ? `Remaining balance: ${quota.aiCredits} AI generation credits`
            : 'Basic mode uses zero AI quota and runs directly in studio speed'}
        </p>
      </div>

    </div>
  );
};
