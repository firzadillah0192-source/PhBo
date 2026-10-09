export const CAPTURE_SECONDS = 5
export const REVIEW_SECONDS = 10
export const RETAKES_PER_POSE = 3
// Deadline-based countdown: delayed browser timers cannot make a capture happen early.
export function startKioskCountdown(seconds, {onTick,onDone,now=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout}) {
 let stopped=false,timer
 const deadline=now()+seconds*1000
 function tick(){
  if(stopped)return
  const remaining=Math.max(0,Math.ceil((deadline-now())/1000))
  onTick(remaining)
  if(!remaining){stopped=true;onDone();return}
  timer=schedule(tick,Math.min(250,Math.max(1,deadline-now())))
 }
 tick()
 return()=>{stopped=true;cancel(timer)}
}
