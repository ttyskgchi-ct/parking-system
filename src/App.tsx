import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabaseClient'

// 型定義
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
    
    await supabase.from('parking_slots').update({
      car_name: sourceSlot.car.name, color: sourceSlot.car.color, status: sourceSlot.car.status,
      plate: sourceSlot.car.plate, car_manager: sourceSlot.car.carManager,
      entry_manager: sourceSlot.car.entryManager, entry_date: getNowTimestamp(),
      memo: sourceSlot.car.memo
    }).eq('id', toId);

    await supabase.from('parking_slots').update({
      car_name: null, color: null, status: null, plate: null,
      car_manager: null, entry_manager: null, entry_date: null, memo: null
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
    if (selectedIds.length === 0) return;
    if (!confirm(`${selectedIds.length}台を一括削除しますか？`)) return;
    await supabase.from('parking_slots').update({ car_name: null, color: null, status: null, plate: null, car_manager: null, entry_manager: null, entry_date: null, memo: null }).in('id', selectedIds);
    setSelectedIds([]); setIsSelectionMode(false); fetchSlots();
  };

  if (loading && slots.length === 0) return <div style={{ textAlign: 'center', padding: '50px' }}>Loading...</div>;

  return (
    <div style={{ backgroundColor: '#f0f2f5', minHeight: '100vh', width: '100vw', fontFamily: 'sans-serif', margin: 0, padding: 0, overflowX: 'hidden' }}>
      
      {/* メニューバー */}
      <div style={{ position: 'sticky', top: 0, backgroundColor: '#ffffff', borderBottom: '1px solid #ddd', padding: '12px 10px', zIndex: 1000, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', maxWidth: '600px', margin: '0 auto' }}>
          <button onClick={() => { setIsSelectionMode(false); setIsMoveMode(false); setSelectedIds([]); setMoveSourceId(null); }} style={{ ...navButtonStyle, backgroundColor: (!isSelectionMode && !isMoveMode) ? '#007bff' : '#f8f9fa', color: (!isSelectionMode && !isMoveMode) ? '#fff' : '#333' }}>入力</button>
          <button onClick={() => { setIsSelectionMode(false); setIsMoveMode(true); setSelectedIds([]); setMoveSourceId(null); }} style={{ ...navButtonStyle, backgroundColor: isMoveMode ? '#ffc107' : '#f8f9fa', color: '#000' }}>移動</button>
          <button onClick={() => { setIsSelectionMode(true); setIsMoveMode(false); setMoveSourceId(null); }} style={{ ...navButtonStyle, backgroundColor: isSelectionMode ? '#dc3545' : '#f8f9fa', color: isSelectionMode ? '#fff' : '#333' }}>削除</button>
        </div>
      </div>

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '20px 10px 150px 10px' }}>
        
        {isMoveMode && (
          <div style={{ textAlign: 'center', marginBottom: '15px', backgroundColor: '#fff3cd', padding: '12px', borderRadius: '8px', fontWeight: 'bold', border: '1px solid #ffeeba', fontSize: '14px' }}>
            {!moveSourceId ? "【移動元の車】をタップ" : "【移動先の場所】をタップ"}
          </div>
        )}

        {/* 駐車場グリッド */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', width: '100%' }}>
          {slots.map((slot) => {
            const isEditing = slot.editing_id !== null && slot.editing_id !== myId;
            const isMoveSource = moveSourceId === slot.id;
            const isSelected = selectedIds.includes(slot.id);

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
                  backgroundColor: isEditing ? '#e9ecef' : (isMoveSource ? '#ffc107' : (isSelected ? '#fff3cd' : (slot.car ? '#fff' : '#f8f9fa'))),
                  borderColor: isMoveSource ? '#ff9800' : (isSelected ? '#dc3545' : (slot.car ? '#007bff' : '#ccc')),
                  borderWidth: (isMoveSource || isSelected) ? '3px' : '1px'
                }}
              >
                <span style={{ fontSize: '10px', color: '#666' }}>{slot.label}</span>
                <span style={{ fontWeight: 'bold', fontSize: '11px', textAlign: 'center' }}>{isEditing ? '入力中' : (slot.car?.name || '空')}</span>
                {!isEditing && slot.car && <span style={{ color: '#007bff', fontSize: '9px', fontWeight: 'bold' }}>{slot.car.status}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* 削除ボタンバー */}
      {isSelectionMode && selectedIds.length > 0 && (
        <div style={{ position: 'fixed', bottom: '25px', left: '50%', transform: 'translateX(-50%)', width: '90%', maxWidth: '400px', backgroundColor: '#fff', padding: '15px', borderRadius: '15px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 2000, border: '2px solid #dc3545' }}>
          <span style={{ fontWeight: 'bold' }}>{selectedIds.length}台 選択</span>
          <button onClick={handleBulkClear} style={{ backgroundColor: '#dc3545', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>一括削除</button>
        </div>
      )}

      {/* モーダル */}
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: '10px' }}>
          <div style={{ backgroundColor: '#fff', width: '100%', maxWidth: '450px', borderRadius: '15px', maxHeight: '95vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '15px 20px', borderBottom: '2px solid #007bff' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>車両情報:[{slots.find(s => s.id === targetSlotId)?.label}]</h2>
            </div>
            <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <input type="text" placeholder="車名" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={modalInputStyle} />
              <input type="text" placeholder="色" value={formData.color} onChange={e => setFormData({...formData, color: e.target.value})} style={modalInputStyle} />
              <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} style={modalInputStyle}>
                {['売約済(小売)','売約済(AA/業販)','在庫','AA行き','解体予定','代車','レンタカー','車検預かり','整備預かり','その他'].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="text" value={formData.entryDate} readOnly style={{ ...modalInputStyle, backgroundColor: '#f0f0f0', flex: 1 }} />
                <button onClick={() => setFormData({...formData, entryDate: getNowTimestamp()})} style={{ backgroundColor: '#28a745', color: '#fff', border: 'none', padding: '0 10px', borderRadius: '6px', cursor: 'pointer' }}>打刻</button>
              </div>
              <textarea placeholder="備考" rows={2} value={formData.memo} onChange={e => setFormData({...formData, memo: e.target.value})} style={modalInputStyle} />
            </div>
            <div style={{ padding: '15px 20px', backgroundColor: '#f8f9fa', display: 'flex', gap: '10px' }}>
              <button onClick={handleEntry} style={{ flex: 2, padding: '14px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '18px', cursor: 'pointer' }}>保存</button>
              <button onClick={() => { supabase.from('parking_slots').update({ editing_id: null }).eq('id', targetSlotId); setIsModalOpen(false); }} style={{ flex: 1, padding: '14px', backgroundColor: '#666', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const navButtonStyle = { flex: 1, padding: '12px 0', border: '1px solid #ddd', borderRadius: '8px', fontWeight: 'bold' as const, fontSize: '13px', cursor: 'pointer' };
const modalInputStyle = { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', fontSize: '16px', boxSizing: 'border-box' as const };

export default App;