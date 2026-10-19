let meetupId=''
let accountReturn=''
export function rememberAccountReturn(url:string){if(/^\/pages\/(lottery-register|messages|staff-workbench|notice-test)\/index(?:\?|$)/.test(url))accountReturn=url}
export function rememberMeetupReturn(id:string){meetupId=id}
export function consumeMeetupReturn(){if(accountReturn){const url=accountReturn;accountReturn='';return url}const id=meetupId;meetupId='';return id?'/pages/meetup-detail/index?id='+encodeURIComponent(id):null}
