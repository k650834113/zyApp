export type StaffTransaction = {
  id:string; kind:'consumption'|'recharge'|'monthly_card'|'refund'; memberName:string;
  memberNumber:string|null; occurredAt:string; title:string; amountFen:number;
  giftFen:number; status:string; businessNumber:string|null; details:string
}
export type TransactionFilters = {fromDate?:string|undefined;toDate?:string|undefined;kind?:string|undefined;query?:string|undefined;offset?:number|undefined}
export type RegistrationBatch = {
  id:string;activityId:string;title:string;capacity:number;registered:number;reserved:number;
  expiresAt:string;revoked:boolean;scene:string;image?:string;
  entries:Array<{id:string;name:string;memberNumber:string;createdAt:string;active:boolean}>
}
export type LotteryAdmission = {
  activityId:string;title:string;rules:string;drawAt:string;expiresAt:string;
  registered:boolean;result:null|{drawnAt:string;prizes:string[]}
}
export type NoticeScene = {
  key:string;title:string;description:string;templateId:string|null;enabled:boolean;
  fields:Record<string,string>
}
export type SubscriptionTicket = {id:string;scene:string;templateId:string;title:string}
export type MemberNotice = {
  id:string;scene:string;title:string;body:string;createdAt:string;read:boolean;
  delivery:string;businessId:string|null
}
export interface WorkspaceClient {
  activities():Promise<Array<{id:string;title:string;drawAt:string}>>
  batches(activityId:string):Promise<RegistrationBatch[]>
  batchCode(id:string):Promise<RegistrationBatch>
  createBatch(input:{requestId:string;activityId:string;capacity:number;envVersion:'release'|'trial'|'develop'}):Promise<RegistrationBatch>
  revokeBatch(id:string):Promise<void>
  cancelEntry(batchId:string,entryId:string,reason:string):Promise<void>
  transactions(filters:TransactionFilters):Promise<{items:StaffTransaction[];hasMore:boolean}>
  admit(scene:string):Promise<LotteryAdmission>
  register(scene:string):Promise<LotteryAdmission>
  lotteryResult(activityId:string):Promise<LotteryAdmission>
  scenes():Promise<NoticeScene[]>
  saveScene(scene:NoticeScene):Promise<void>
  prepareSubscription(scene:string,businessId?:string):Promise<SubscriptionTicket|null>
  recordSubscription(id:string,result:string):Promise<void>
  notices(offset?:number):Promise<{items:MemberNotice[];hasMore:boolean}>
  readNotice(id:string):Promise<MemberNotice>
}
