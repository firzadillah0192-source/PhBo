import {useEffect,useRef,useState} from 'react'
import {getPrinterStatus,getPrintJob,hasDesktopPrinter,pairPrinter,printerMessage,submitPrint} from '../../kioskPrinter.js'
export default function useKioskPrinter(resultId,mode,imageUrl){
 const [status,setStatus]=useState(null),[receipt,setReceipt]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const operation=useRef(false),mounted=useRef(false)
 useEffect(()=>{mounted.current=true;if(hasDesktopPrinter())getPrinterStatus().then(s=>{if(mounted.current)setStatus(s)}).catch(e=>{if(mounted.current)setError(printerMessage(e.message))});return()=>{mounted.current=false}},[])
 useEffect(()=>{setReceipt(null);if(!resultId||!status)return;let cancelled=false;getPrintJob(resultId).then(r=>{if(!cancelled)setReceipt(r)}).catch(e=>{if(!cancelled)setError(printerMessage(e.message))});return()=>{cancelled=true}},[resultId,status])
 async function connect(code){if(operation.current)return;operation.current=true;setBusy(true);setError('');try{const value=await pairPrinter(code);if(mounted.current)setStatus(value)}catch(e){if(mounted.current)setError(printerMessage(e.message))}finally{operation.current=false;if(mounted.current)setBusy(false)}}
 async function print(){if(operation.current||!resultId)return;operation.current=true;setBusy(true);setError('');try{const value=await submitPrint(resultId,mode,imageUrl);if(mounted.current)setReceipt(value)}catch(e){if(mounted.current){setError(printerMessage(e.message));try{setReceipt(await getPrintJob(resultId))}catch{setReceipt({status:'UNKNOWN'})}}}finally{operation.current=false;if(mounted.current)setBusy(false)}}
 return {status,receipt,error,busy,connect,print,ready:['READY','SIMULATED'].includes(status?.printer),locked:!!receipt&&receipt.status!=='REJECTED'}
}
