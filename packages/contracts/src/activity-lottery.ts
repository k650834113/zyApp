export type LotteryConfig = {
  startsAt:string; closesAt:string; drawAt:string; multipleEntries:boolean; repeatWinners:boolean;
  rules:string; prizes:Array<{id:string;name:string;description:string;count:number}>
}
export type LotteryEntry = {
  id:string;memberId:string;memberNumber:string;name:string;phone:string;createdAt:string;actorId:string;
  active:boolean;changes:Array<{active:boolean;reason:string;at:string;actorId:string}>
}
export type LotteryResult = {
  drawnAt:string;actorId:string;entries:LotteryEntry[];
  prizes:Array<{id:string;name:string;description:string;count:number;winners:Array<{entryId:string;memberId:string;memberNumber:string;name:string;phone:string}>;vacancies:number}>
}
export type LotteryWorkspace = {activityId:string;revision:string|null;rulesLocked:boolean;config:LotteryConfig|null;entries:LotteryEntry[];result:LotteryResult|null}
export type LotteryCommand = {requestId:string;activityId:string;expectedRevision:string|null} & (
  {action:'configure';config:LotteryConfig}|{action:'register';memberId:string}|
  {action:'entry-status';entryId:string;active:boolean;reason:string}|{action:'draw'})
export type LotteryMember = {memberId:string;memberNumber:string;name:string;phone:string}
