/**
 * Device-code login: show a short code, wait for a staff member to approve it on the web, keep the token.
 * Polling runs in the trusted main process; the renderer only sees `state`.
 */
export class DeviceLogin {
  constructor({client,name,onApproved,onChange=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>Date.now()}) {
    Object.assign(this,{client,name,onApproved,onChange,sleep,now});
    this.state={status:'idle'};this.run=0;
  }
  set(state){this.state=state;this.onChange();}
  async start() {
    if(this.state.status==='pending')return this.state;
    const run=++this.run;
    let started;
    try{started=await this.client.start(this.name);}catch(error){this.set({status:'error',error:/^[A-Z0-9_]+$/.test(error?.message)?error.message:'LOGIN_FAILED'});return this.state;}
    this.set({status:'pending',userCode:started.user_code,url:started.verification_url,expiresAt:this.now()+started.expires_in*1000});
    this.wait(run,started.device_code,Math.max(1000,(started.interval||3)*1000)); // not awaited: polling continues in the background
    return this.state;
  }
  async wait(run,deviceCode,interval) {
    const until=this.state.expiresAt;
    while(run===this.run&&this.now()<until) {
      await this.sleep(interval);
      if(run!==this.run)return;
      let result;
      try{result=await this.client.poll(deviceCode);}
      catch(error){
        if(error?.message==='DEVICE_CODE_EXPIRED'){this.set({status:'expired'});return;}
        continue; // offline or transient server error: keep trying until the code expires
      }
      if(result.status==='approved') {
        try{await this.onApproved(result);}catch{this.set({status:'error',error:'LOGIN_SAVE_FAILED'});return;}
        this.set({status:'approved'});return;
      }
    }
    if(run===this.run)this.set({status:'expired'});
  }
  cancel(){this.run++;this.set({status:'idle'});}
}
