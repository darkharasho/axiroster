import RosterSkeleton from './RosterSkeleton'
import DepartedSkeleton from './DepartedSkeleton'
import LogSkeleton from './LogSkeleton'
import RetentionSkeleton from './RetentionSkeleton'
import RecruitmentSkeleton from './RecruitmentSkeleton'
import { SettingsSkeleton, SharingSkeleton } from './PageSkeletons'

export type GuildTab = 'roster' | 'log' | 'departed' | 'sharing' | 'settings' | 'retention' | 'recruitment'

// The pane App shows while a guild switch is in flight: the target tab's own
// skeleton, which the view then keeps showing until its first load lands.
export default function TabSkeleton({ tab, attendance }: { tab: GuildTab; attendance?: boolean }): JSX.Element {
  switch (tab) {
    case 'roster': return <RosterSkeleton attendance={attendance} />
    case 'log': return <LogSkeleton />
    case 'departed': return <DepartedSkeleton />
    case 'retention': return <RetentionSkeleton />
    case 'recruitment': return <RecruitmentSkeleton />
    case 'sharing': return <SharingSkeleton />
    case 'settings': return <SettingsSkeleton />
  }
}
