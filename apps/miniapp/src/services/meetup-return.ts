let meetupId=''
export function rememberMeetupReturn(id:string){meetupId=id}
export function consumeMeetupReturn(){const id=meetupId;meetupId='';return id?'/pages/meetup-detail/index?id='+encodeURIComponent(id):null}
