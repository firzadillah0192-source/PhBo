import React, { useEffect, useState } from 'react';
import { Sparkles, Camera } from 'lucide-react';
import { UserPhoto, StudioTemplate, AIExperience, GenerationResult } from '../types';
import { processPhotoboothImage } from '../utils/imageProcessor';

interface ProcessingStageProps {
  mode: 'basic' | 'advanced';
  userPhoto: UserPhoto;
  selectedTemplate?: StudioTemplate;
  selectedExperience?: AIExperience;
  onGenerationComplete: (result: GenerationResult) => void;
  onGenerationFailed: (errorMsg: string) => void;
}

type StepStatus = 'queued' | 'processing' | 'finishing' | 'completed';

export const ProcessingStage: React.FC<ProcessingStageProps> = ({
  mode,
  userPhoto,
  selectedTemplate,
  selectedExperience,
  onGenerationComplete,
  onGenerationFailed,
}) => {
  const [status, setStatus] = useState<StepStatus>('queued');
  const [statusCopy, setStatusCopy] = useState<string>('Preparing your portrait');

  const experienceTitle = mode === 'basic' ? selectedTemplate?.title : selectedExperience?.title;

  useEffect(() => {
    let isCancelled = false;

    const runPipeline = async () => {
      try {
        // Stage 1: Queued
        setStatus('queued');
        setStatusCopy('Preparing your portrait');
        await new Promise((r) => setTimeout(r, 900));
        if (isCancelled) return;

        // Stage 2: Processing (World Transformation)
        setStatus('processing');
        setStatusCopy(mode === 'basic' ? 'Applying studio chemistry & lighting' : 'Building your world');
        
        // Execute real image stylization & canvas compositing
        const processedDataUrl = await processPhotoboothImage(userPhoto.dataUrl, {
          mode,
          template: selectedTemplate,
          experience: selectedExperience,
        });

        await new Promise((r) => setTimeout(r, 1400));
        if (isCancelled) return;

        // Stage 3: Finishing
        setStatus('finishing');
        setStatusCopy('Finishing your image');
        await new Promise((r) => setTimeout(r, 800));
        if (isCancelled) return;

        // Stage 4: Completed
        setStatus('completed');
        const result: GenerationResult = {
          id: 'res-' + Date.now(),
          imageUrl: processedDataUrl,
          originalPhotoUrl: userPhoto.dataUrl,
          experienceTitle: experienceTitle || 'Photobooth Portrait',
          mode,
          createdAt: Date.now(),
        };

        setTimeout(() => {
          if (!isCancelled) {
            onGenerationComplete(result);
          }
        }, 500);

      } catch (err: any) {
        console.error('Processing error:', err);
        if (!isCancelled) {
          onGenerationFailed(err?.message || 'We could not complete the portrait transformation.');
        }
      }
    };

    runPipeline();

    return () => {
      isCancelled = true;
    };
  }, [mode, userPhoto, selectedTemplate, selectedExperience]);

  return (
    <div className="min-h-screen pt-24 pb-28 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto flex flex-col items-center justify-center select-none text-center">
      
      {/* CENTRAL FLOATING PORTRAIT IN LIVING DEPTH */}
      <div className="relative w-72 sm:w-80 aspect-[3/4] mb-10">
        
        {/* Soft atmospheric rotating aura */}
        <div className="absolute -inset-8 rounded-full bg-gradient-to-tr from-[#6558FF]/20 via-[#9CC8FF]/25 to-[#F3B587]/20 blur-2xl animate-spin-slow pointer-events-none" />

        {/* Orbiting celestial ring */}
        <div className="absolute -inset-4 border border-[#6558FF]/30 rounded-3xl animate-pulse pointer-events-none" />

        {/* The portrait card floating */}
        <div className="relative w-full h-full rounded-3xl overflow-hidden bg-[#181A20] shadow-[0_25px_60px_rgba(101,88,255,0.18)] border border-white/40">
          <img
            src={userPhoto.dataUrl}
            alt="Transforming Portrait"
            className="w-full h-full object-cover filter transition-all duration-1000 scale-105"
          />

          {/* Sweeping light beam */}
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/35 to-transparent -translate-x-full animate-shimmer pointer-events-none" />

          {/* Focus shift gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
        </div>

        {/* Floating status pill */}
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 z-20 px-4 py-1.5 rounded-full bg-white/90 backdrop-blur-md border border-[#E8E8E5] shadow-md flex items-center gap-2 whitespace-nowrap">
          {mode === 'advanced' ? (
            <Sparkles className="w-3.5 h-3.5 text-[#6558FF] animate-spin" />
          ) : (
            <Camera className="w-3.5 h-3.5 text-[#111216]" />
          )}
          <span className="text-xs font-semibold text-[#111216]">
            {experienceTitle}
          </span>
        </div>
      </div>

      {/* MINIMAL EDITORIAL STATE MESSAGING (NO FAKE % NUMBERS) */}
      <div className="max-w-md mx-auto">
        <h3 className="font-editorial text-3xl sm:text-4xl text-[#111216] font-normal tracking-tight mb-2">
          {statusCopy}
        </h3>
        <p className="font-sans-clean text-xs text-[#787B86] tracking-wide uppercase">
          {status === 'queued' && 'Allocating studio pipeline'}
          {status === 'processing' && 'Synthesizing lighting, grain & dimensional depth'}
          {status === 'finishing' && 'Rendering master photograph'}
          {status === 'completed' && 'Transformation finalized'}
        </p>

        {/* Thin elegant breathing line */}
        <div className="w-36 h-[2px] bg-[#E8E8E5] rounded-full mx-auto mt-6 overflow-hidden">
          <div className="w-full h-full bg-[#6558FF] animate-pulse" />
        </div>
      </div>

    </div>
  );
};
