// Frontend presentation contract. PC publishing / cloud writes are not connected yet.
export type CommunityGame = {id:string;name:string;imageUrl:string|null}
export type MeetupView = {id:string;game:CommunityGame;title:string;date:string;time:string;duration:number;capacity:number;deadline:string;location:string;description:string;tags:string[];players:string[];joined:boolean;owned:boolean}
export type PlayView = {id:string;game:CommunityGame;date:string;duration:number;mode:string;players:{name:string;score:string;rank:number}[];note:string;visibility:string}
export type CommunitySnapshot = {meetups:MeetupView[];plays:PlayView[]}
export type ScoreDraft = {players:import('@zyapp/contracts').PlayPlayer[];tableId?:string;onSaved?:()=>void}
let scoreDraft:ScoreDraft|null=null
export function rememberScoreDraft(draft:ScoreDraft){scoreDraft=draft}
export function consumeScoreDraft(){const draft=scoreDraft;scoreDraft=null;return draft}
