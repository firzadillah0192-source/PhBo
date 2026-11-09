import React, { useEffect, useRef } from 'react';
import { AppMode, AppStep } from '../types';

interface CelestialCanvasProps {
  currentMode: AppMode;
  hoveredMode: 'basic' | 'advanced' | null;
  currentStep: AppStep;
}

export const CelestialCanvas: React.FC<CelestialCanvasProps> = ({
  currentMode,
  hoveredMode,
  currentStep,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 });
  const timeRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Normalized between -1 and 1
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      mouseRef.current.targetX = nx;
      mouseRef.current.targetY = ny;
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Curated photo panels inside the world
    const photoImg1 = new Image();
    photoImg1.crossOrigin = 'anonymous';
    photoImg1.src = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80';

    const photoImg2 = new Image();
    photoImg2.crossOrigin = 'anonymous';
    photoImg2.src = 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80';

    const photoImg3 = new Image();
    photoImg3.crossOrigin = 'anonymous';
    photoImg3.src = 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=600&q=80';

    // Cloud clusters
    const clouds = Array.from({ length: 9 }).map((_, i) => ({
      x: Math.random() * width,
      y: (height * 0.15) + (Math.random() * height * 0.6),
      radius: 120 + Math.random() * 160,
      speed: 0.12 + Math.random() * 0.22,
      opacity: 0.25 + Math.random() * 0.35,
      scaleX: 1.6 + Math.random() * 0.8,
      layer: i % 3, // 0 far, 1 mid, 2 foreground
    }));

    // Water particles for waterfall
    const waterParticles = Array.from({ length: 45 }).map(() => ({
      x: 0,
      y: 0,
      vy: 1.8 + Math.random() * 2.5,
      vx: (Math.random() - 0.5) * 0.6,
      alpha: 0.2 + Math.random() * 0.5,
      size: 1.5 + Math.random() * 2.5,
      offset: Math.random() * 200,
    }));

    // Floating stardust & luminous mist motes
    const motes = Array.from({ length: 35 }).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: -0.15 - Math.random() * 0.3,
      size: 1 + Math.random() * 2.5,
      alpha: 0.15 + Math.random() * 0.45,
    }));

    let lastTime = performance.now();

    const render = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      timeRef.current += dt;
      const t = timeRef.current;

      // Mouse lerp
      mouseRef.current.x += (mouseRef.current.targetX - mouseRef.current.x) * 0.04;
      mouseRef.current.y += (mouseRef.current.targetY - mouseRef.current.y) * 0.04;

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      // 18-second continuous cinematic camera cycle
      // Phase 1 (0-5s): slow forward push
      // Phase 2 (5-10s): slow sideways tracking
      // Phase 3 (10-15s): light elevation shift
      // Phase 4 (15-18s): smooth recovery
      const cycleTime = 18;
      const normCycle = (t % cycleTime) / cycleTime;
      const camPush = Math.sin(normCycle * Math.PI * 2) * 16;
      const camTrack = Math.cos(normCycle * Math.PI * 2) * 24;
      const camBob = Math.sin(normCycle * Math.PI * 4) * 8;

      // Interaction reaction with Basic / Advanced hover
      const isBasic = hoveredMode === 'basic' || currentMode === 'basic';
      const isAdvanced = hoveredMode === 'advanced' || currentMode === 'advanced';

      // Step depth shift
      let stepDepth = 0;
      if (currentStep === 'gallery') stepDepth = 20;
      if (currentStep === 'capture') stepDepth = 35;
      if (currentStep === 'review') stepDepth = 45;
      if (currentStep === 'processing') stepDepth = 60;
      if (currentStep === 'result') stepDepth = 15;

      ctx.clearRect(0, 0, width, height);

      // 1. SKY ATMOSPHERE (Celestial Digital Studio Gradient)
      const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
      if (isAdvanced) {
        // More fantastical ethereal celestial sky
        skyGrad.addColorStop(0, '#EAEBFF');
        skyGrad.addColorStop(0.35, '#E2EEFD');
        skyGrad.addColorStop(0.7, '#F3E8DF');
        skyGrad.addColorStop(1, '#F7F7F5');
      } else if (isBasic) {
        // Calmer, architectural photographic daylight
        skyGrad.addColorStop(0, '#EEF2F5');
        skyGrad.addColorStop(0.4, '#F1F4F7');
        skyGrad.addColorStop(0.8, '#EAECE9');
        skyGrad.addColorStop(1, '#F7F7F5');
      } else {
        // Balanced pristine celestial
        skyGrad.addColorStop(0, '#EEF3F8');
        skyGrad.addColorStop(0.3, '#E6EEF6');
        skyGrad.addColorStop(0.65, '#F7EDE4');
        skyGrad.addColorStop(1, '#F7F7F5');
      }
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, width, height);

      // 2. SOFT SUN LIGHT SHAFT / LUMINOUS ORB
      const sunX = width * 0.72 + camTrack * 0.4 + mx * 15;
      const sunY = height * 0.22 + camBob * 0.3 + my * 15;
      const sunGlow = ctx.createRadialGradient(sunX, sunY, 30, sunX, sunY, width * 0.45);
      sunGlow.addColorStop(0, isAdvanced ? 'rgba(255, 245, 230, 0.42)' : 'rgba(255, 250, 240, 0.32)');
      sunGlow.addColorStop(0.4, isAdvanced ? 'rgba(243, 181, 135, 0.16)' : 'rgba(243, 181, 135, 0.08)');
      sunGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = sunGlow;
      ctx.fillRect(0, 0, width, height);

      // 3. DISTANT MOUNTAIN PEAKS & CLOUD HORIZON
      const mtnBaseY = height * 0.65 + camBob * 0.2 + my * 8;
      ctx.save();
      ctx.fillStyle = isAdvanced ? 'rgba(156, 180, 215, 0.35)' : 'rgba(175, 192, 208, 0.32)';
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(0, mtnBaseY - 40);
      ctx.quadraticCurveTo(width * 0.2, mtnBaseY - 110, width * 0.38, mtnBaseY - 30);
      ctx.quadraticCurveTo(width * 0.55, mtnBaseY - 95, width * 0.75, mtnBaseY - 140);
      ctx.quadraticCurveTo(width * 0.88, mtnBaseY - 100, width, mtnBaseY - 50);
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 4. FLOATING CELESTIAL ISLAND (MIDGROUND)
      const islandX = width * 0.22 + camTrack * 0.6 + mx * 20;
      const islandY = height * 0.48 + camBob * 0.5 + my * 18 - stepDepth * 0.3;
      const islandW = Math.min(width * 0.42, 480);
      const islandH = 75;

      ctx.save();
      // Island base underside
      const islandUnderGrad = ctx.createLinearGradient(islandX, islandY, islandX, islandY + islandH + 45);
      islandUnderGrad.addColorStop(0, '#A7B3BE');
      islandUnderGrad.addColorStop(0.4, '#7F8D9A');
      islandUnderGrad.addColorStop(1, 'rgba(127, 141, 154, 0)');
      ctx.fillStyle = islandUnderGrad;
      ctx.beginPath();
      ctx.ellipse(islandX + islandW / 2, islandY + islandH / 2, islandW / 2, islandH / 2, 0, 0, Math.PI);
      ctx.fill();

      // Island grassy plateau
      ctx.fillStyle = '#9FB8A2'; // Nature green
      ctx.beginPath();
      ctx.ellipse(islandX + islandW / 2, islandY, islandW / 2, 26, 0, 0, Math.PI * 2);
      ctx.fill();

      // Luxury Modern Architecture / Pavilion on Island
      const archX = islandX + islandW * 0.42;
      const archY = islandY - 60;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(archX, archY, 68, 55);
      // Cantilevered glass canopy
      ctx.fillStyle = 'rgba(156, 200, 255, 0.45)';
      ctx.fillRect(archX - 18, archY, 105, 7);
      // Slender architectural columns
      ctx.fillStyle = '#252830';
      ctx.fillRect(archX + 8, archY + 7, 3, 48);
      ctx.fillRect(archX + 56, archY + 7, 3, 48);
      // Soft glow inside pavilion
      ctx.fillStyle = 'rgba(243, 181, 135, 0.5)';
      ctx.fillRect(archX + 16, archY + 16, 36, 32);

      // Waterfall spilling from floating island
      const wfX = islandX + islandW * 0.28;
      const wfY = islandY + 12;
      const wfGrad = ctx.createLinearGradient(wfX, wfY, wfX, wfY + 140);
      wfGrad.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
      wfGrad.addColorStop(0.5, 'rgba(191, 221, 244, 0.5)');
      wfGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = wfGrad;
      ctx.fillRect(wfX - 4, wfY, 9, 130);

      // Cascading water particles
      waterParticles.forEach((p) => {
        p.y = (p.y + p.vy) % 130;
        ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha * 0.8})`;
        ctx.beginPath();
        ctx.arc(wfX + p.vx * 15, wfY + p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();

      // 5. PHOTOGRAPHIC INSTALLATIONS (2-3 integrated editorial panels)
      // Panel 1: Tall portrait glass installation overlooking left horizon
      if (photoImg1.complete && photoImg1.naturalWidth > 0) {
        const p1X = width * 0.12 + camTrack * 0.8 + mx * 28;
        const p1Y = height * 0.28 + camBob * 0.7 + my * 22 + Math.sin(t * 0.6) * 6;
        const p1W = 100;
        const p1H = 145;

        ctx.save();
        // Glass frame cast shadow
        ctx.shadowColor = 'rgba(17, 18, 22, 0.12)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 14;

        // White border
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(p1X - 5, p1Y - 5, p1W + 10, p1H + 10);
        ctx.shadowColor = 'transparent';

        // Photo image
        ctx.drawImage(photoImg1, p1X, p1Y, p1W, p1H);

        // Glass reflection sheen
        const sheen = ctx.createLinearGradient(p1X, p1Y, p1X + p1W, p1Y + p1H);
        sheen.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
        sheen.addColorStop(0.4, 'rgba(255, 255, 255, 0.05)');
        sheen.addColorStop(1, 'rgba(156, 200, 255, 0.18)');
        ctx.fillStyle = sheen;
        ctx.fillRect(p1X, p1Y, p1W, p1H);

        ctx.restore();
      }

      // Panel 2: Floating gallery panel near right horizon
      if (photoImg2.complete && photoImg2.naturalWidth > 0) {
        const p2X = width * 0.82 + camTrack * 0.75 + mx * 26;
        const p2Y = height * 0.36 + camBob * 0.6 + my * 20 + Math.cos(t * 0.5) * 8;
        const p2W = 110;
        const p2H = 155;

        ctx.save();
        ctx.shadowColor = 'rgba(17, 18, 22, 0.1)';
        ctx.shadowBlur = 22;
        ctx.shadowOffsetY = 12;

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(p2X - 5, p2Y - 5, p2W + 10, p2H + 10);
        ctx.shadowColor = 'transparent';

        ctx.drawImage(photoImg2, p2X, p2Y, p2W, p2H);

        // Subtle warm highlight
        const sheen2 = ctx.createLinearGradient(p2X, p2Y, p2X + p2W, p2Y + p2H);
        sheen2.addColorStop(0, 'rgba(243, 181, 135, 0.25)');
        sheen2.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)');
        sheen2.addColorStop(1, 'rgba(255, 255, 255, 0.2)');
        ctx.fillStyle = sheen2;
        ctx.fillRect(p2X, p2Y, p2W, p2H);

        ctx.restore();
      }

      // 6. LUMINOUS DRIFTING CLOUDS (Layers with varying parallax)
      clouds.forEach((cloud) => {
        cloud.x += cloud.speed;
        if (cloud.x - cloud.radius * 2 > width) {
          cloud.x = -cloud.radius * 2;
        }

        const pMulti = cloud.layer === 0 ? 0.3 : cloud.layer === 1 ? 0.7 : 1.2;
        const cx = cloud.x + camTrack * pMulti + mx * (10 * pMulti);
        const cy = cloud.y + camBob * pMulti + my * (8 * pMulti);

        ctx.save();
        const cloudGrad = ctx.createRadialGradient(cx, cy, cloud.radius * 0.1, cx, cy, cloud.radius);
        cloudGrad.addColorStop(0, `rgba(255, 255, 255, ${cloud.opacity * 0.85})`);
        cloudGrad.addColorStop(0.5, `rgba(245, 248, 252, ${cloud.opacity * 0.5})`);
        cloudGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = cloudGrad;

        ctx.beginPath();
        ctx.ellipse(cx, cy, cloud.radius * cloud.scaleX, cloud.radius, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // 7. FOREGROUND LUXURY ARCHITECTURAL CORNER & GLASS BRIDGE (Subtle framing)
      const fgArchX = -40 + camTrack * 1.3 + mx * 35;
      const fgArchY = height * 0.72 + camBob * 1.1 + my * 30;
      ctx.save();
      // Glass terrace railing
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.fillRect(fgArchX, fgArchY, width * 0.35, 14);
      // Railing posts
      ctx.fillStyle = 'rgba(37, 40, 48, 0.25)';
      for (let rx = fgArchX + 20; rx < fgArchX + width * 0.35; rx += 45) {
        ctx.fillRect(rx, fgArchY + 14, 2.5, 45);
      }
      ctx.restore();

      // 8. FOREGROUND MIST & LUMINOUS PARTICLES
      motes.forEach((m) => {
        m.x += m.vx;
        m.y += m.vy;
        if (m.y < 0) {
          m.y = height;
          m.x = Math.random() * width;
        }
        if (m.x < 0) m.x = width;
        if (m.x > width) m.x = 0;

        ctx.fillStyle = `rgba(255, 255, 255, ${m.alpha * (isAdvanced ? 1.2 : 0.8)})`;
        ctx.beginPath();
        ctx.arc(m.x + mx * 18, m.y + my * 18, m.size, 0, Math.PI * 2);
        ctx.fill();
      });

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, [currentMode, hoveredMode, currentStep]);

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none">
      <canvas ref={canvasRef} className="w-full h-full block" />
      {/* Soft atmospheric overlay for high contrast readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#F7F7F5]/85" />
    </div>
  );
};
