/** A response may update the selection only while its generation is current. */
export class MemberSelection {
  private generation = 0
  memberId: string | null = null
  select(memberId: string | null): number {
    this.memberId = memberId
    return ++this.generation
  }
  capture(): number { return this.generation }
  accepts(generation: number, memberId: string | null): boolean {
    return generation === this.generation && memberId === this.memberId
  }
}
