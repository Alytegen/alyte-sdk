import type { Transport } from './http.js';
export type AccessAudience = {kind:'everyone'} | {kind:'membership';programId:string;levels:string[]} | {kind:'scheme';schemes:Array<'visa'|'mastercard'|'amex'>};
export interface AccessDraftInput { requestId:string;offerId:string;name:string;audience?:AccessAudience;opensAt?:string;closesAt?:string }
export interface AccessRule extends Omit<AccessDraftInput,'requestId'> { id:string;revision:number;status:'draft'|'scheduled'|'cancelled'|'archived' }
export interface MembershipProgram { id:string;name:string;levels:string[] }
export interface AccessPreview { id:string;rule:AccessRule;action:'schedule'|'cancel';expiresAt:string;observedAt:string;
  impact:{total:number;earlier:number;later:number;unchanged:number};timeZone:string;generalSaleAt:string|null }
export interface AccessCommitInput { requestId:string;expectedRevision:number;previewId:string }
export interface MembershipEvidence { requestId:string;sourceRevision:number;level:string;validFrom:string;validUntil:string;evidenceRef:string;revoked:boolean }
const base=(shop:string)=>`/v1/integration/merchants/${encodeURIComponent(shop)}/access`;

/** Backend-only merchant access control. Save each request UUID before dispatch and
 * reuse it only for the exact same operation. No mutation is retried automatically. */
export class MerchantAccessRules {
  constructor(private readonly t:Transport) {}
  list(shop:string):Promise<{rules:AccessRule[];programs:MembershipProgram[]}> {return this.t.request('GET',base(shop));}
  get(shop:string,id:string):Promise<{rule:AccessRule}> {return this.t.request('GET',`${base(shop)}/rules/${encodeURIComponent(id)}`);}
  createDraft(shop:string,input:AccessDraftInput):Promise<{rule:AccessRule}> {return this.t.request('POST',`${base(shop)}/rules`,input);}
  updateDraft(shop:string,id:string,input:AccessDraftInput & {expectedRevision:number}):Promise<{rule:AccessRule}> {return this.t.request('PUT',`${base(shop)}/rules/${encodeURIComponent(id)}`,input);}
  preview(shop:string,id:string,action:'schedule'|'cancel'='schedule'):Promise<AccessPreview> {return this.t.request('POST',`${base(shop)}/rules/${encodeURIComponent(id)}/preview`,{action});}
  schedule(shop:string,id:string,input:AccessCommitInput):Promise<{rule:AccessRule}> {return this.t.request('POST',`${base(shop)}/rules/${encodeURIComponent(id)}/schedule`,input);}
  cancel(shop:string,id:string,input:AccessCommitInput):Promise<{rule:AccessRule}> {return this.t.request('POST',`${base(shop)}/rules/${encodeURIComponent(id)}/cancel`,input);}
}
/** A merchant attests membership in its own program, not payment permission. */
export class MerchantMemberships {
  constructor(private readonly t:Transport) {}
  createProgram(shop:string,input:{requestId:string;name:string;levels:string[]}):Promise<{program:MembershipProgram}> {return this.t.request('POST',`${base(shop)}/programs`,input);}
  upsert(shop:string,programId:string,buyerId:string,input:MembershipEvidence):Promise<{membership:{programId:string;buyerId:string;sourceRevision:number;revoked:boolean}}> {
    return this.t.request('PUT',`${base(shop)}/programs/${encodeURIComponent(programId)}/members/${encodeURIComponent(buyerId)}`,input);
  }
}
