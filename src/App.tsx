import { useState, useEffect, useMemo } from 'react'
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

  const fetchSlots = async () => {
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
  };

  useEffect(() => {
    fetchSlots();
    const channel = supabase.channel('parking_realtime').on('postgres_changes', { event: '*', schema: 'public', table: 'parking_slots' }, () => { fetchSlots(); }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const getNowTimestamp = () => {
    const now = new Date();
    return `${now.getFullYear()}/${(now.getMonth()+1)}/${now.getDate()} ${now.getHours()}:${now.getMinutes().toString().padStart(2,'0')}`;
  };

  const handleMove = async (toId: number) => {
    if (!moveSourceId) return;
    const sourceSlot = slots.find(s => s.id === moveSourceId);
    if (!sourceSlot || !sourceSlot.car) return;
    
    const { error: errorAdd } = await supabase.from('parking_slots').update({
      car_name: sourceSlot.car.name, color: sourceSlot.car.color, status: sourceSlot.car.status,
      plate: sourceSlot.car.plate, car_manager: sourceSlot.car.carManager,
      entry_manager: sourceSlot.car.entryManager, entry_date: getNowTimestamp(),
      memo: sourceSlot.car.memo
    }).eq('id', toId);

    if (errorAdd) { alert('移動に失敗しました'); return; }

    await supabase.from('parking_slots').update({
      car_name: null, color: null, status: null, plate: null,
      car_manager: null, entry_manager: null, entry_date: null, memo: null
    }).eq('id', moveSourceId);

    setMoveSourceId(null);
    setIsMoveMode(false);
    fetchSlots();
  };

  const lockSlot = async (id: number) => {
    const { error } = await supabase.from('parking_slots').update({ editing_id: myId, locked_at: new Date().toISOString() }).eq('id', id).is('editing_id', null);
    return !error;
  };

  const unlockSlot = async (id: number | null) => {
    if (!id) return;
    await supabase.from('parking_slots').update({ editing_id: null, locked_at: null }).eq('id', id).eq('editing_id', myId);
  };

  const openForm = async (slot: Slot) => {
    if (slot.editing_id && slot.editing_id !== myId) { alert('他の人が入力中です'); return; }
    const success = await lockSlot(slot.id);
    if (!success) { alert('他の方が入力中のため開けません'); fetchSlots(); return; }
    setTargetSlotId(slot.id);
    setFormData(slot.car || { name: '', color: '', status: '在庫', plate: '有', carManager: '社員名１', entryManager: '社員名１', entryDate: '', memo: '' });
    setIsModalOpen(true);
  };

  const handleEntry = async () => {
    if (!targetSlotId) return;
    const { error } = await supabase.from('parking_slots').update({
      car_name: formData.name, color: formData.color, status: formData.status,
      plate: formData.plate, car_manager: formData.carManager,
      entry_manager: formData.entryManager, entry_date: formData.entryDate, memo: formData.memo,
      editing_id: null, locked_at: null
    }).eq('id', targetSlotId);
    if (!error) { setIsModalOpen(false); setTargetSlotId(null); fetchSlots(); }
  };

  const handleBulkClear = async () => {
    if (!confirm(`${selectedIds.length}台を削除しますか？`)) return;
    await supabase.from('parking_slots').update({ car_name: null, color: null, status: null, plate: null, car_manager: null, entry_manager: null, entry_date: null, memo: null }).in('id', selectedIds);
    setSelectedIds([]); setIsSelectionMode(false); fetchSlots();
  };

  if (loading && slots.length === 0) return <div style={{ textAlign: 'center', padding: '50px' }}>読み込み中...</div>;

  return (
    <div style={{ backgroundColor: '#f8f9fa', minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: 'sans-serif' }}>
      <div style={{ width: '100%', maxWidth: '900px', padding: '20px 10px 140px 10px', boxSizing: 'border-box' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 'bold', textAlign: 'center', margin: '10px 0 25px 0' }}>🚗 駐車場管理システム</h1>
        
        {/* --- モード切替エリア (ここを確実に表示されるよう修正) --- */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          marginBottom: '20px', 
          gap: '8px', 
          width: '100%',
          flexWrap: 'nowrap' // スマホでも1行に収める
        }}>
          <button 
            onClick={() => { setIsSelectionMode(false); setIsMoveMode(false); setSelectedIds([]); setMoveSourceId(null); }} 
            style={{ ...modeButtonStyle, flex: 1, backgroundColor: (!isSelectionMode && !isMoveMode) ? '#007bff' : '#ffffff', color: (!isSelectionMode && !isMoveMode) ? '#fff' : '#333', border: '1px solid #ccc' }}
          >
            入力
          </button>
          <button 
            onClick={() => { setIsSelectionMode(false); setIsMoveMode(true); setSelectedIds([]); setMoveSourceId(null); }} 
            style={{ ...modeButtonStyle, flex: 1, backgroundColor: isMoveMode ? '#ffc107' : '#ffffff', color: isMoveMode ? '#000' : '#333', border: '1px solid #ccc' }}
          >
            移動
          </button>
          <button 
            onClick={() => { setIsSelectionMode(true); setIsMoveMode(false); setMoveSourceId(null); }} 
            style={{ ...modeButtonStyle, flex: 1, backgroundColor: isSelectionMode ? '#dc3545' : '#ffffff', color: isSelectionMode ? '#fff' : '#333', border: '1px solid #ccc' }}
          >
            削除
          </button>
        </div>

        {isMoveMode && (
          <div style={{ textAlign: 'center', marginBottom: '15px', color: '#856404', backgroundColor: '#fff3cd', padding: '12px', borderRadius: '8px', fontWeight: 'bold', fontSize: '14px', border: '1px solid #ffeeba' }}>
            {!moveSourceId ? "【移動させる車】を選択してください" : "【移動先の場所】を選択してください"}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1fr 1fr 1.8fr', gap: '8px', width: '100%' }}>
          {slots.map((slot) => {
            const isSelected = selectedIds.includes(slot.id);
            const isEditing = slot.editing_id !== null && slot.editing_id !== myId;
            const isMoveSource = moveSourceId === slot.id;
            const isSide = slot.label.includes('-'); 

            return (
              <div 
                key={slot.id} 
                onClick={() => {
                  if (isEditing) return;
                  if (isMoveMode) {
                    if (!moveSourceId) {
                      if (slot.car) setMoveSourceId(slot.id);
                    } else {
                      if (moveSourceId === slot.id) setMoveSourceId(null);
                      else handleMove(slot.id);
                    }
                  } else if (isSelectionMode) {
                    setSelectedIds(prev => isSelected ? prev.filter(id => id !== slot.id) : [...prev, slot.id]);
                  } else {
                    openForm(slot);
                  }
                }}
                style={{
                  minHeight: '85px', 
                  backgroundColor: isEditing ? '#ddd' : (isMoveSource ? '#fff3cd' : (isSelected ? '#fff3cd' : (slot.car ? '#fff' : '#f0f0f0'))),
                  border: isEditing ? '2px dashed #999' : (isMoveSource ? '3px solid #ffc107' : (isSelected ? '3px solid #dc3545' : (slot.car ? '2px solid #007bff' : '1px solid #ccc'))),
                  borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: isEditing ? 0.7 : 1, padding: '4px'
                }}
              >
                <strong style={{ fontSize: '10px', color: '#666' }}>{slot.label}</strong>
                <span style={{ fontWeight: 'bold', fontSize: isSide ? '13px' : '10px', textAlign: 'center', color: '#000' }}>
                  {isEditing ? '入力中...' : (slot.car?.name || '空')}
                </span>
                {!isEditing && slot.car && <span style={{ color: '#007bff', fontSize: '9px', fontWeight: 'bold' }}>{slot.car.status}</span>}
              </div>
            );
          })}
        </div>

        {isSelectionMode && selectedIds.length > 0 && (
          <div style={floatingBarStyle}>
            <span style={{ fontWeight: 'bold' }}>{selectedIds.length}台 選択中</span>
            <button onClick={handleBulkClear} style={bulkDeleteButtonStyle}>削除実行</button>
          </div>
        )}

        {isModalOpen && (
          <div style={modalOverlayStyle}>
            <div style={modalContentStyle}>
              <div style={{ padding: '15px 20px', borderBottom: '2px solid #007bff' }}>
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
                    <button onClick={() => setFormData({...formData, entryDate: getNowTimestamp()})} style={{ backgroundColor: '#28a745', color: '#fff', border: 'none', padding: '0 12px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}>打刻</button>
                  </div>
                </div>
                <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 備考</span><textarea rows={2} value={formData.memo} onChange={e => setFormData({...formData, memo: e.target.value})} style={{...inputStyle, height: '60px'}} /></div>
              </div>
              <div style={{ padding: '15px 20px', backgroundColor: '#f8f9fa', borderTop: '1px solid #ddd', display: 'flex', gap: '10px' }}>
                <button onClick={handleEntry} style={{ flex: 2, padding: '14px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '18px', cursor: 'pointer' }}>保存する</button>
                <button onClick={() => { unlockSlot(targetSlotId); setIsModalOpen(false); }} style={{ flex: 1, padding: '14px', backgroundColor: '#666', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>閉じる</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const modeButtonStyle = { padding: '10px 5px', borderRadius: '6px', fontWeight: 'bold' as const, fontSize: '14px', cursor: 'pointer' };
const floatingBarStyle = { position: 'fixed' as const, bottom: '20px', left: '50%', transform: 'translateX(-50%)', width: '92%', maxWidth: '400px', backgroundColor: '#fff', padding: '15px', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 9999, border: '1px solid #dc3545' };
const bulkDeleteButtonStyle = { backgroundColor: '#dc3545', color: 'white', border: 'none', padding: '10px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' };
const modalOverlayStyle = { position: 'fixed' as const, top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '10px', boxSizing: 'border-box' as const };
const modalContentStyle = { backgroundColor: '#fff', width: '100%', maxWidth: '450px', borderRadius: '15px', maxHeight: '95vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const fieldGroupStyle = { display: 'flex', flexDirection: 'column' as const, gap: '4px' };
const labelStyle = { fontSize: '13px', fontWeight: 'bold' as const, color: '#444' };
const inputStyle = { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', fontSize: '16px', boxSizing: 'border-box' as const };

export default App