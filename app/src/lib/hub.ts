// Shared hub: labeled reference links + the "want-to" boards (drink/eat/watch/
// visit/listen). Both partners can read and write (RLS: is_member / editor).

import { supabase } from './supabase';
import type { BoardItem, BoardKind, SharedLink } from './types';

export async function fetchSharedLinks(): Promise<SharedLink[]> {
  const { data, error } = await supabase
    .from('shared_links')
    .select('id, label, url, created_by, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SharedLink[];
}

export async function addSharedLink(label: string, url: string): Promise<SharedLink> {
  const { data, error } = await supabase
    .from('shared_links')
    .insert({ label, url })
    .select('id, label, url, created_by, created_at')
    .single();
  if (error) throw error;
  return data as SharedLink;
}

export async function deleteSharedLink(id: string): Promise<void> {
  const { error } = await supabase.from('shared_links').delete().eq('id', id);
  if (error) throw error;
}

const BOARD_COLS = 'id, board, title, url, note, done, done_at, created_by, created_at';

export async function fetchBoardItems(): Promise<BoardItem[]> {
  const { data, error } = await supabase
    .from('board_items')
    .select(BOARD_COLS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as BoardItem[];
}

export async function addBoardItem(
  board: BoardKind,
  title: string,
  url?: string,
  note?: string,
): Promise<BoardItem> {
  const { data, error } = await supabase
    .from('board_items')
    .insert({ board, title, url: url || null, note: note || null })
    .select(BOARD_COLS)
    .single();
  if (error) throw error;
  return data as BoardItem;
}

export async function setBoardItemDone(id: string, done: boolean): Promise<void> {
  const { error } = await supabase
    .from('board_items')
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteBoardItem(id: string): Promise<void> {
  const { error } = await supabase.from('board_items').delete().eq('id', id);
  if (error) throw error;
}
