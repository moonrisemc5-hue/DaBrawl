grant delete on public.dabrawl_friend_requests to authenticated;
drop policy if exists "Users can remove accepted friendships" on public.dabrawl_friend_requests;
create policy "Users can remove accepted friendships"
  on public.dabrawl_friend_requests for delete to authenticated
  using ((auth.uid() = requester_id or auth.uid() = addressee_id) and status = 'accepted');