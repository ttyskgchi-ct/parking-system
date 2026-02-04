import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './supabaseClient'

interface CarDetails {
  name: string; color: string; status: string; plate: string;
  carManager: string; entryManager: string; entryDate: string; memo: string;
}

interface Slot {
  id: number; label: string; car: CarDetails | null;
  editing_id: string | null;
}

const getMyId = () => {
  let id = localStorage.getItem('parking_user_id');
  if (!id) {
    id = 'user-' + Math.random().toString(36).substring(2, 11);
    localStorage.setItem('parking_user_id', id);
  }
  return id;
};

function App() {
  const myId = useMemo(() => getMyId(), []);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [targetSlotId, setTargetSlotId] = useState<number | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isMoveMode, setIsMoveMode] = useState(false); 
  const [moveSourceId, setMoveSourceId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [formData, setFormData] = useState<CarDetails>({
    name: '', color: '', status: '在庫', plate: '有', carManager: '社員名１', entryManager: '社員名１', entryDate: '', memo: ''
  });

  const fetchSlots = useCallback(async () => {
    const { data, error } = await supabase.from('parking_slots').select('*').order('id', { ascending: true });
    if (!error && data) {
      const formatted: Slot[] = data.map(d => ({
        id: d.id, label: d.label, editing_id: d.editing_id,
        car: d.car_name ? {
          name: d.car_name, color: d.color, status: d.status,
          plate: d.plate, carManager: d.car_manager,
          entryManager: d.entry_manager, entryDate: d.entry_date, memo: d.memo
        } : null
      }));
      setSlots(formatted);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSlots();
    const channel = supabase.channel('parking_realtime').on('postgres_changes', { event: '*', schema: 'public', table: 'parking_slots' }, () => { fetchSlots(); }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchSlots]);

  const getNowTimestamp = () => {
    const now = new Date();
    return `${now.getFullYear()}/${(now.getMonth()+1)}/${now.getDate()} ${now.getHours()}:${now.getMinutes().toString().padStart(2,'0')}`;
  };

  const handleMove = async (toId: number) => {
    if (!moveSourceId) return;
    const sourceSlot = slots.find(s => s.id === moveSourceId);
    if (!sourceSlot || !sourceSlot.car) return;
    
    await supabase.from('parking_slots').update({
      car_name: sourceSlot.car.name, color: sourceSlot.car.color, status: sourceSlot.car.status,
      plate: sourceSlot.car.plate, car_manager: sourceSlot.car.carManager,
      entry_manager: sourceSlot.car.entryManager, entry_date: getNowTimestamp(),
      memo: sourceSlot.car.memo
    }).eq('id', toId);

    await supabase.from('parking_slots').update({
      car_name: null, color: null, status: null, plate: null, car_manager: null, entry_manager: null, entry_date: null, memo: null
    }).eq('id', moveSourceId);

    setMoveSourceId(null);
    setIsMoveMode(false);
    fetchSlots();
  };

  const openForm = async (slot: Slot) => {
    if (slot.editing_id && slot.editing_id !== myId) { alert('他の方が入力中です'); return; }
    await supabase.from('parking_slots').update({ editing_id: myId, locked_at: new Date().toISOString() }).eq('id', slot.id).is('editing_id', null);
    setTargetSlotId(slot.id);
    setFormData(slot.car || { name: '', color: '', status: '在庫', plate: '有', carManager: '社員名１', entryManager: '社員名１', entryDate: '', memo: '' });
    setIsModalOpen(true);
  };

  const handleEntry = async () => {
    if (!targetSlotId) return;
    await supabase.from('parking_slots').update({
      car_name: formData.name, color: formData.color, status: formData.status,
      plate: formData.plate, car_manager: formData.carManager,
      entry_manager: formData.entryManager, entry_date: formData.entryDate, memo: formData.memo,
      editing_id: null, locked_at: null
    }).eq('id', targetSlotId);
    setIsModalOpen(false); setTargetSlotId(null); fetchSlots();
  };

  const handleBulkClear = async () => {
    if (!confirm(`${selectedIds.length}台を削除しますか？`)) return;
    await supabase.from('parking_slots').update({ car_name: null, color: null, status: null, plate: null, car_manager: null, entry_manager: null, entry_date: null, memo: null }).in('id', selectedIds);
    setSelectedIds([]); setIsSelectionMode(false); fetchSlots();
  };

  if (loading && slots.length === 0) return <div style={{ textAlign: 'center', padding: '50px' }}>読み込み中...</div>;

  return (
    <div style={{ backgroundColor: '#f8f9fa', minHeight: '100vh', width: '100%', fontFamily: 'sans-serif', margin: 0, padding: 0 }}>
      
      {/* 1. タイトル復活 */}
      <div style={{ backgroundColor: '#fff', padding: '15px 0' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 'bold', textAlign: 'center', margin: 0 }}>🚗 駐車場管理システム</h1>
      </div>

      {/* 2. 操作メニュー（固定） */}
      <div style={{ position: 'sticky', top: 0, backgroundColor: '#ffffff', borderBottom: '1px solid #ddd', zIndex: 1000, padding: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', maxWidth: '600px', margin: '0 auto' }}>
          <button onClick={() => { setIsSelectionMode(false); setIsMoveMode(false); setSelectedIds([]); setMoveSourceId(null); }} style={{ ...navButtonStyle, backgroundColor: (!isSelectionMode && !isMoveMode) ? '#007bff' : '#f8f9fa', color: (!isSelectionMode && !isMoveMode) ? '#fff' : '#333' }}>入力</button>
          <button onClick={() => { setIsSelectionMode(false); setIsMoveMode(true); setSelectedIds([]); setMoveSourceId(null); }} style={{ ...navButtonStyle, backgroundColor: isMoveMode ? '#ffc107' : '#f8f9fa', color: '#000' }}>移動</button>
          <button onClick={() => { setIsSelectionMode(true); setIsMoveMode(false); setMoveSourceId(null); }} style={{ ...navButtonStyle, backgroundColor: isSelectionMode ? '#dc3545' : '#f8f9fa', color: isSelectionMode ? '#fff' : '#333' }}>削除</button>
        </div>
      </div>

      <div style={{ maxWidth: '950px', margin: '0 auto', padding: '20px 10px 160px 10px' }}>
        {isMoveMode && (
          <div style={{ textAlign: 'center', marginBottom: '15px', backgroundColor: '#fff3cd', padding: '12px', borderRadius: '8px', fontWeight: 'bold', border: '1px solid #ffeeba' }}>
            {!moveSourceId ? "【移動元の車】を選択してください" : "【移動先の場所】を選択してください"}
          </div>
        )}

        {/* 3. オブジェクトの幅（西・東が広い）を復活 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1fr 1fr 1.8fr', gap: '8px' }}>
          {slots.map((slot) => {
            const isEditing = slot.editing_id !== null && slot.editing_id !== myId;
            const isMoveSource = moveSourceId === slot.id;
            const isSelected = selectedIds.includes(slot.id);
            const isSide = slot.label.includes('-'); 

            return (
              <div 
                key={slot.id} 
                onClick={() => {
                  if (isEditing) return;
                  if (isMoveMode) {
                    if (!moveSourceId && slot.car) setMoveSourceId(slot.id);
                    else if (moveSourceId) {
                       if (moveSourceId === slot.id) setMoveSourceId(null);
                       else handleMove(slot.id);
                    }
                  } else if (isSelectionMode) {
                    setSelectedIds(prev => isSelected ? prev.filter(id => id !== slot.id) : [...prev, slot.id]);
                  } else { openForm(slot); }
                }}
                style={{
                  minHeight: '85px', borderRadius: '8px', border: '1px solid #ccc', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  backgroundColor: isEditing ? '#e9ecef' : (isMoveSource ? '#ffc107' : (isSelected ? '#fff3cd' : (slot.car ? '#fff' : '#f0f0f0'))),
                  borderColor: isMoveSource ? '#ff9800' : (isSelected ? '#dc3545' : (slot.car ? '#007bff' : '#ccc')),
                  borderWidth: (isMoveSource || isSelected) ? '3px' : '1px'
                }}
              >
                <span style={{ fontSize: '10px', color: '#666' }}>{slot.label}</span>
                <span style={{ fontWeight: 'bold', fontSize: isSide ? '14px' : '11px', textAlign: 'center' }}>{isEditing ? '入力中' : (slot.car?.name || '空')}</span>
                {!isEditing && slot.car && <span style={{ color: '#007bff', fontSize: '9px', fontWeight: 'bold' }}>{slot.car.status}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. 入力項目のタイトルと全項目を復旧 */}
      {isModalOpen && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle}>
            <div style={{ padding: '15px 20px', borderBottom: '2px solid #007bff', backgroundColor: '#fff' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>車両情報:[{slots.find(s => s.id === targetSlotId)?.label}]</h2>
            </div>
            <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 車名</span><input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={inputStyle} /></div>
              <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 色</span><input type="text" value={formData.color} onChange={e => setFormData({...formData, color: e.target.value})} style={inputStyle} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 状況</span>
                  <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} style={inputStyle}>
                    {['売約済(小売)','売約済(AA/業販)','在庫','AA行き','解体予定','代車','レンタカー','車検預かり','整備預かり','その他'].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ プレート</span>
                  <select value={formData.plate} onChange={e => setFormData({...formData, plate: e.target.value})} style={inputStyle}><option value="有">有</option><option value="無">無</option></select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 車両担当</span>
                  <select value={formData.carManager} onChange={e => setFormData({...formData, carManager: e.target.value})} style={inputStyle}><option value="社員名１">社員名１</option><option value="社員名２">社員名２</option></select>
                </div>
                <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 入庫担当</span>
                  <select value={formData.entryManager} onChange={e => setFormData({...formData, entryManager: e.target.value})} style={inputStyle}><option value="社員名１">社員名１</option><option value="社員名２">社員名２</option></select>
                </div>
              </div>
              <div style={fieldGroupStyle}>
                <span style={labelStyle}>◻︎ 入庫日</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="text" value={formData.entryDate} readOnly style={{ ...inputStyle, backgroundColor: '#f0f0f0', flex: 1 }} />
                  <button onClick={() => setFormData({...formData, entryDate: getNowTimestamp()})} style={{ backgroundColor: '#28a745', color: '#fff', border: 'none', padding: '0 12px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>打刻</button>
                </div>
              </div>
              <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 備考</span><textarea rows={2} value={formData.memo} onChange={e => setFormData({...formData, memo: e.target.value})} style={{...inputStyle, height: '60px'}} /></div>
            </div>
            <div style={{ padding: '15px 20px', backgroundColor: '#f8f9fa', borderTop: '1px solid #ddd', display: 'flex', gap: '10px' }}>
              <button onClick={handleEntry} style={{ flex: 2, padding: '14px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '18px', cursor: 'pointer' }}>保存する</button>
              <button onClick={() => { supabase.from('parking_slots').update({ editing_id: null }).eq('id', targetSlotId); setIsModalOpen(false); }} style={{ flex: 1, padding: '14px', backgroundColor: '#666', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {isSelectionMode && selectedIds.length > 0 && (
        <div style={floatingBarStyle}>
          <span style={{ fontWeight: 'bold' }}>{selectedIds.length}台 選択</span>
          <button onClick={handleBulkClear} style={bulkDeleteButtonStyle}>削除実行</button>
        </div>
      )}
    </div>
  );
}

const navButtonStyle = { flex: 1, padding: '12px 0', border: '1px solid #ddd', borderRadius: '8px', fontWeight: 'bold' as const, fontSize: '13px', cursor: 'pointer' };
const floatingBarStyle = { position: 'fixed' as const, bottom: '25px', left: '50%', transform: 'translateX(-50%)', width: '92%', maxWidth: '400px', backgroundColor: '#fff', padding: '15px', borderRadius: '15px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 2000, border: '1px solid #dc3545' };
const bulkDeleteButtonStyle = { backgroundColor: '#dc3545', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' };
const modalOverlayStyle = { position: 'fixed' as const, top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: '10px' };

// ↓ ここを string ではなく column 固定にして型エラーを回避
const modalContentStyle = { 
  backgroundColor: '#fff', width: '100%', maxWidth: '450px', borderRadius: '15px', 
  maxHeight: '95vh', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' 
};

const fieldGroupStyle = { display: 'flex', flexDirection: 'column' as const, gap: '4px' };
const labelStyle = { fontSize: '13px', fontWeight: 'bold' as const, color: '#444' };
const inputStyle = { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', fontSize: '16px', boxSizing: 'border-box' as const };

export default App;