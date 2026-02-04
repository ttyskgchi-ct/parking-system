import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabaseClient'

interface CarDetails {
  name: string; color: string; status: string; plate: string;
  carManager: string; entryManager: string; entryDate: string; memo: string;
}

interface Slot {
  id: number; label: string; car: CarDetails | null;
  editing_id: string | null; // 誰が編集しているかのID
}

// ブラウザごとに一意のIDを生成または取得
const getMyId = () => {
  let id = localStorage.getItem('parking_user_id');
  if (!id) {
    id = 'user-' + Math.random().toString(36).substr(2, 9);
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
  const [loading, setLoading] = useState(true);

  const [formData, setFormData] = useState<CarDetails>({
    name: '', color: '', status: '在庫', plate: '有', carManager: '社員名１', entryManager: '社員名１', entryDate: '', memo: ''
  });

  useEffect(() => {
    fetchSlots();

    // ★リアルタイム購読の設定
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'parking_slots' },
        () => { fetchSlots(); } // 変化があったら再取得
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchSlots = async () => {
    const { data, error } = await supabase
      .from('parking_slots')
      .select('*')
      .order('id', { ascending: true });

    if (!error && data) {
      const formatted: Slot[] = data.map(d => ({
        id: d.id,
        label: d.label,
        editing_id: d.editing_id,
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

  // 編集ロックを取得
  const lockSlot = async (id: number) => {
    const { error } = await supabase
      .from('parking_slots')
      .update({ editing_id: myId, locked_at: new Date().toISOString() })
      .eq('id', id)
      .is('editing_id', null); // 誰も編集していない時だけ成功する
    return !error;
  };

  // 編集ロックを解除
  const unlockSlot = async (id: number | null) => {
    if (!id) return;
    await supabase
      .from('parking_slots')
      .update({ editing_id: null, locked_at: null })
      .eq('id', id)
      .eq('editing_id', myId); // 自分がロックした時だけ解除できる
  };

  const openForm = async (slot: Slot) => {
    if (slot.editing_id && slot.editing_id !== myId) {
      alert('現在、他の人が入力中です。');
      return;
    }

    const success = await lockSlot(slot.id);
    if (!success) {
      alert('タッチの差で他の人が入力を開始しました。');
      fetchSlots();
      return;
    }

    setTargetSlotId(slot.id);
    setFormData(slot.car || { name: '', color: '', status: '在庫', plate: '有', carManager: '社員名１', entryManager: '社員名１', entryDate: '', memo: '' });
    setIsModalOpen(true);
  };

  const handleCloseModal = async () => {
    await unlockSlot(targetSlotId);
    setIsModalOpen(false);
    setTargetSlotId(null);
  };

  const handleTimestamp = () => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}/${(now.getMonth()+1)}/${now.getDate()} ${now.getHours()}:${now.getMinutes().toString().padStart(2,'0')}`;
    setFormData({...formData, entryDate: dateStr});
  };

  const handleEntry = async () => {
    if (!targetSlotId) return;
    const { error } = await supabase
      .from('parking_slots')
      .update({
        car_name: formData.name, color: formData.color, status: formData.status,
        plate: formData.plate, car_manager: formData.carManager,
        entry_manager: formData.entryManager, entry_date: formData.entryDate, memo: formData.memo,
        editing_id: null, locked_at: null // 保存と同時にロック解除
      })
      .eq('id', targetSlotId);

    if (error) {
      alert('保存に失敗しました');
    } else {
      setIsModalOpen(false);
      setTargetSlotId(null);
      fetchSlots();
    }
  };

  if (loading && slots.length === 0) return <div style={{ textAlign: 'center', padding: '50px' }}>読み込み中...</div>;

  return (
    <div style={{ backgroundColor: '#f8f9fa', minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: 'sans-serif' }}>
      <div style={{ width: '100%', maxWidth: '900px', padding: '20px 10px 120px 10px', boxSizing: 'border-box' }}>
        
        <h1 style={{ fontSize: '22px', fontWeight: 'bold', textAlign: 'center', color: '#000', margin: '10px 0 25px 0' }}>🚗 駐車場管理システム</h1>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '30px', gap: '15px' }}>
          <button onClick={() => { setIsSelectionMode(false); setSelectedIds([]); }} style={{ ...modeButtonStyle, backgroundColor: !isSelectionMode ? '#007bff' : '#ccc' }}>入力モード</button>
          <button onClick={() => setIsSelectionMode(true)} style={{ ...modeButtonStyle, backgroundColor: isSelectionMode ? '#dc3545' : '#ccc', color: isSelectionMode ? '#fff' : '#000' }}>削除モード</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1fr 1fr 1.8fr', gap: '8px', width: '100%' }}>
          {slots.map((slot) => {
            const isSelected = selectedIds.includes(slot.id);
            const isEditing = slot.editing_id !== null && slot.editing_id !== myId;
            const isSide = slot.label.includes('-'); 

            return (
              <div 
                key={slot.id} 
                onClick={() => isSelectionMode ? (isEditing ? null : setSelectedIds(prev => isSelected ? prev.filter(id => id !== slot.id) : [...prev, slot.id])) : openForm(slot)}
                style={{
                  minHeight: '85px', 
                  backgroundColor: isEditing ? '#ddd' : (isSelected ? '#fff3cd' : (slot.car ? '#fff' : '#f0f0f0')),
                  border: isEditing ? '2px dashed #999' : (isSelected ? '3px solid #dc3545' : (slot.car ? '2px solid #007bff' : '1px solid #ccc')),
                  borderRadius: '8px', 
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', 
                  cursor: isEditing ? 'not-allowed' : 'pointer',
                  opacity: isEditing ? 0.7 : 1,
                  padding: '4px', minWidth: isSide ? '80px' : '50px'
                }}
              >
                <strong style={{ fontSize: '10px', color: '#666' }}>{slot.label}</strong>
                <span style={{ fontWeight: 'bold', fontSize: isSide ? '14px' : '11px', color: isEditing ? '#777' : '#000', textAlign: 'center' }}>
                  {isEditing ? '入力中...' : (slot.car?.name || '空')}
                </span>
                {!isEditing && slot.car && <span style={{ color: '#007bff', fontSize: '10px', fontWeight: 'bold' }}>{slot.car.status}</span>}
              </div>
            );
          })}
        </div>

        {isModalOpen && (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '10px', boxSizing: 'border-box' }}>
            <div style={{ backgroundColor: '#fff', width: '100%', maxWidth: '450px', borderRadius: '15px', maxHeight: '95vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
                    <button onClick={handleTimestamp} style={{ backgroundColor: '#28a745', color: '#fff', border: 'none', padding: '0 15px', borderRadius: '6px', fontWeight: 'bold' }}>打刻</button>
                  </div>
                </div>
                <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 備考</span><textarea rows={2} value={formData.memo} onChange={e => setFormData({...formData, memo: e.target.value})} style={{...inputStyle, height: '60px'}} /></div>
              </div>
              <div style={{ padding: '15px 20px', backgroundColor: '#f8f9fa', borderTop: '1px solid #ddd', display: 'flex', gap: '10px' }}>
                <button onClick={handleEntry} style={{ flex: 2, padding: '14px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '18px' }}>保存する</button>
                <button onClick={handleCloseModal} style={{ flex: 1, padding: '14px', backgroundColor: '#666', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold' }}>閉じる</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const modeButtonStyle = { padding: '12px 24px', border: 'none', borderRadius: '30px', color: '#fff', fontWeight: 'bold' as const, fontSize: '14px', cursor: 'pointer' };
const fieldGroupStyle = { display: 'flex', flexDirection: 'column' as const, gap: '4px' };
const labelStyle = { fontSize: '13px', fontWeight: 'bold' as const, color: '#444' };
const inputStyle = { width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ccc', fontSize: '16px', color: '#000', backgroundColor: '#ffffff', boxSizing: 'border-box' as const };

export default App