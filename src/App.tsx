import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

interface CarDetails {
  name: string; color: string; status: string; plate: string;
  carManager: string; entryManager: string; entryDate: string; memo: string;
}

interface Slot {
  id: number; label: string; car: CarDetails | null;
}

function App() {
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
  }, []);

  const fetchSlots = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('parking_slots')
        .select('*')
        .order('id', { ascending: true });

      if (data && data.length > 0) {
        const formatted = data.map(d => ({
          id: d.id, label: d.label,
          car: d.car_name ? {
            name: d.car_name, color: d.color, status: d.status,
            plate: d.plate, carManager: d.car_manager,
            entryManager: d.entry_manager, entryDate: d.entry_date, memo: d.memo
          } : null
        }));
        setSlots(formatted);
      } else {
        generateInitialSlots();
      }
    } catch (e) {
      generateInitialSlots();
    }
    setLoading(false);
  };

  const generateInitialSlots = () => {
    const initial: Slot[] = [];
    for (let i = 1; i <= 50; i++) {
      let label = '縦';
      if (i % 5 === 1) label = `西-${Math.ceil(i/5)}`;
      if (i % 5 === 0) label = `東-${Math.ceil(i/5)}`;
      initial.push({ id: i, label: label, car: null });
    }
    setSlots(initial);
  };

  const openForm = (slot: Slot) => {
    setTargetSlotId(slot.id);
    setFormData(slot.car || { name: '', color: '', status: '在庫', plate: '有', carManager: '社員名１', entryManager: '社員名１', entryDate: '', memo: '' });
    setIsModalOpen(true);
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
        entry_manager: formData.entryManager, entry_date: formData.entryDate, memo: formData.memo
      })
      .eq('id', targetSlotId);

    if (error) {
      alert('保存に失敗しました。RLS設定を確認してください: ' + error.message);
    } else {
      await fetchSlots();
      setIsModalOpen(false);
    }
  };

  const handleBulkClear = async () => {
    if (!confirm(`${selectedIds.length}台を選択中。一括で空車にしますか？`)) return;
    await supabase.from('parking_slots').update({
      car_name: null, color: null, status: null, plate: null,
      car_manager: null, entry_manager: null, entry_date: null, memo: null
    }).in('id', selectedIds);
    await fetchSlots();
    setSelectedIds([]);
  };

  if (loading && slots.length === 0) return <div style={{ textAlign: 'center', padding: '50px', color: '#000' }}>データを読み込み中...</div>;

  return (
    <div style={{ padding: '10px', paddingBottom: '100px', fontFamily: 'sans-serif', backgroundColor: '#f8f9fa', minHeight: '100vh' }}>
      <h1 style={{ fontSize: '18px', textAlign: 'center', color: '#000', marginBottom: '10px' }}>🚗 駐車場管理システム</h1>

      {/* モード切替ボタン（デザイン復元） */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '15px', gap: '10px' }}>
        <button 
          onClick={() => { setIsSelectionMode(false); setSelectedIds([]); }}
          style={{ ...modeButtonStyle, backgroundColor: !isSelectionMode ? '#007bff' : '#ccc' }}
        >
          通常モード（入庫・編集）
        </button>
        <button 
          onClick={() => setIsSelectionMode(true)}
          style={{ ...modeButtonStyle, backgroundColor: isSelectionMode ? '#ffc107' : '#ccc', color: '#000' }}
        >
          選択モード（一括削除）
        </button>
      </div>

      {/* 駐車場グリッド（サイズ復元） */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1.5fr', gap: '6px', maxWidth: '800px', margin: '0 auto' }}>
        {slots.map((slot) => {
          const isSelected = selectedIds.includes(slot.id);
          return (
            <div 
              key={slot.id} 
              onClick={() => isSelectionMode ? setSelectedIds(prev => isSelected ? prev.filter(id => id !== slot.id) : [...prev, slot.id]) : openForm(slot)}
              style={{
                minHeight: '70px', backgroundColor: isSelected ? '#fff3cd' : (slot.car ? '#fff' : '#eee'),
                border: isSelected ? '3px solid #ffc107' : (slot.car ? '2px solid #007bff' : '1px dashed #ccc'),
                borderRadius: '5px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: '10px', cursor: 'pointer'
              }}
            >
              <strong style={{ color: '#000' }}>{slot.label}</strong>
              <span style={{ fontWeight: 'bold', fontSize: '11px', color: '#000' }}>{slot.car?.name || '空'}</span>
              {slot.car && <span style={{ color: '#007bff', fontSize: '9px', marginTop: '2px', fontWeight: 'bold' }}>{slot.car.status}</span>}
            </div>
          );
        })}
      </div>

      {/* 入庫・編集フォーム（項目と視認性を復元） */}
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div style={{ backgroundColor: '#fff', width: '92%', maxWidth: '450px', padding: '20px', borderRadius: '12px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontSize: '18px', marginBottom: '15px', borderBottom: '3px solid #007bff', paddingBottom: '10px', color: '#000' }}>
              {slots.find(s => s.id === targetSlotId)?.car ? '車両情報 編集' : '新規 入庫登録'}
              <span style={{ color: '#444', fontSize: '14px', marginLeft: '10px' }}>[{slots.find(s => s.id === targetSlotId)?.label}]</span>
            </h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 車名</span><input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={inputStyle} /></div>
              <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 色</span><input type="text" value={formData.color} onChange={e => setFormData({...formData, color: e.target.value})} style={inputStyle} /></div>
              <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 状況</span>
                <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} style={inputStyle}>
                  {['売約済(小売)','売約済(AA/業販)','在庫','AA行き','解体予定','代車','レンタカー','車検預かり','整備預かり','その他'].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ プレート</span>
                <select value={formData.plate} onChange={e => setFormData({...formData, plate: e.target.value})} style={inputStyle}><option value="有">有</option><option value="無">無</option></select>
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
                  <input type="text" value={formData.entryDate} readOnly style={{ ...inputStyle, backgroundColor: '#f0f0f0', border: '1px solid #999', flex: 1, fontWeight: 'bold' }} />
                  <button onClick={handleTimestamp} style={{ backgroundColor: '#28a745', color: '#fff', border: 'none', padding: '0 15px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>打刻</button>
                </div>
              </div>

              <div style={fieldGroupStyle}><span style={labelStyle}>◻︎ 備考</span><textarea rows={2} value={formData.memo} onChange={e => setFormData({...formData, memo: e.target.value})} style={inputStyle} /></div>
              
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button onClick={handleEntry} style={{ flex: 2, padding: '14px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '18px' }}>保存する</button>
                <button onClick={() => setIsModalOpen(false)} style={{ flex: 1, padding: '14px', backgroundColor: '#444', color: '#fff', border: 'none', borderRadius: '8px' }}>閉じる</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 一括削除バー（デザイン復元） */}
      {isSelectionMode && selectedIds.length > 0 && (
        <div style={{ position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', width: '90%', maxWidth: '500px', backgroundColor: '#fff', padding: '15px', borderRadius: '15px', boxShadow: '0 -5px 25px rgba(0,0,0,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1000, border: '1px solid #ddd' }}>
          <span style={{ fontWeight: 'bold', color: '#000' }}>{selectedIds.length} 台を選択中</span>
          <button onClick={handleBulkClear} style={{ backgroundColor: '#dc3545', color: 'white', border: 'none', padding: '12px 20px', borderRadius: '8px', fontWeight: 'bold' }}>一括で空車にする</button>
        </div>
      )}
    </div>
  )
}

const modeButtonStyle = { padding: '10px 15px', border: 'none', borderRadius: '20px', color: '#fff', fontWeight: 'bold' as const, fontSize: '12px', cursor: 'pointer' };
const fieldGroupStyle = { display: 'flex', flexDirection: 'column' as const, gap: '4px' };
const labelStyle = { fontSize: '14px', fontWeight: 'bold' as const, color: '#000' };
const inputStyle = { width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid #666', fontSize: '16px', outline: 'none', color: '#000', backgroundColor: '#ffffff', boxSizing: 'border-box' as const };

export default App