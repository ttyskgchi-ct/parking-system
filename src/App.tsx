import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './supabaseClient'

interface CarDetails {
  name: string; customerName: string; color: string; status: string; plate: string;
  carManager: string; entryManager: string; entryDate: string; memo: string;
}

interface Slot {
  id: number; label: string; area_name: string; car: CarDetails | null;
  editing_id: string | null; last_ping: string | null;
}

const AREAS = ["裏駐車場", "タワー", "極上仕上場"];
const STAFF_LIST = ["岡﨑 有功", "森岡 央行", "岡本 康一", "岡本 慎平", "谷本 貢一", "朝栄 拓海", "亀島 大夢", "淺野 佳菜子", "坪井 美佳", "杉山 詩織", "難波 成美", "平井 旭", "中村 俊也", "岸戸 彪我", "藤田 陸", "藤田 佳代", "福家 君佳", "安達 未来", "田中 美夕日", "平山 暁美", "松本 由香", "高下 ゆかり", "松浦 広司", "平塚 円", "坂口 達哉", "藤井 武司", "上山 紀昭"];
const STATUS_LIST = ['売約済(小売)', '売約済(AA/業販)', '在庫', 'AA行き', '解体予定', '代車', 'レンタカー', '車検預かり', '整備預かり', 'その他'];

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
  const [currentArea, setCurrentArea] = useState(AREAS[0]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [targetSlotId, setTargetSlotId] = useState<number | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isMoveMode, setIsMoveMode] = useState(false); 
  const [moveSourceId, setMoveSourceId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterManager, setFilterManager] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const initialFormData: CarDetails = {
    name: '', customerName: '', color: '', status: '', plate: '有', carManager: '', entryManager: '', entryDate: '', memo: ''
  };
  const [formData, setFormData] = useState<CarDetails>(initialFormData);

  const isLockExpired = (lastPing: string | null) => {
    if (!lastPing) return true;
    const last = new Date(lastPing).getTime();
    const now = new Date().getTime();
    return (now - last) > 5 * 60 * 1000;
  };

  const fetchSlots = useCallback(async () => {
    const { data, error } = await supabase.from('parking_slots').select('*').order('id', { ascending: true });
    if (!error && data) {
      const formatted: Slot[] = data.map(d => {
        let displayLabel = d.label;
        if (d.area_name === '裏駐車場' && d.label.startsWith('東-')) {
          const num = parseInt(d.label.replace('東-', ''));
          if (num >= 1 && num <= 10) displayLabel = `東-${num + 15}`;
        }
        return {
          id: d.id, label: displayLabel, area_name: d.area_name || '裏駐車場',
          editing_id: d.editing_id, last_ping: d.last_ping,
          car: d.car_name ? {
            name: d.car_name, customerName: d.customer_name || '', color: d.color, status: d.status || '',
            plate: d.plate || '有', carManager: d.car_manager || '', entryManager: d.entry_manager || '', 
            entryDate: d.entry_date, memo: d.memo
          } : null
        };
      });
      setSlots(formatted);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSlots();
    const channel = supabase.channel('schema-db-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'parking_slots' }, () => fetchSlots()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchSlots]);

  const handleForceUnlock = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm('このスロットのロックを強制解除しますか？')) return;
    await supabase.from('parking_slots').update({ editing_id: null, last_ping: null }).eq('id', id);
    fetchSlots();
  };

  const getNowTimestamp = () => {
    const now = new Date();
    return `${now.getFullYear()}/${(now.getMonth()+1)}/${now.getDate()} ${now.getHours()}:${now.getMinutes().toString().padStart(2,'0')}`;
  };

  const displaySlots = useMemo(() => slots.filter(s => s.area_name === currentArea), [slots, currentArea]);

  const handleMove = async (toId: number) => {
    const src = slots.find(s => s.id === moveSourceId);
    if (!src || !src.car) return;
    await supabase.from('parking_slots').update({
      car_name: src.car.name, customer_name: src.car.customerName, color: src.car.color, status: src.car.status,
      plate: src.car.plate, car_manager: src.car.carManager, entry_manager: src.car.entryManager, 
      entry_date: src.car.entryDate, memo: src.car.memo, editing_id: null, last_ping: null
    }).eq('id', toId);
    await supabase.from('parking_slots').update({ car_name: null, customer_name: null, color: null, status: null, plate: null, car_manager: null, entry_manager: null, entry_date: null, memo: null, editing_id: null, last_ping: null }).eq('id', moveSourceId);
    setMoveSourceId(null); fetchSlots();
  };

  const openForm = async (slot: Slot) => {
    const isLocked = slot.editing_id && !isLockExpired(slot.last_ping);
    if (isLocked && slot.editing_id !== myId) return;
    await supabase.from('parking_slots').update({ editing_id: myId, last_ping: new Date().toISOString() }).eq('id', slot.id);
    setTargetSlotId(slot.id); setFormData(slot.car || initialFormData); setIsModalOpen(true);
  };

  const closeModal = async () => {
    if (targetSlotId) await supabase.from('parking_slots').update({ editing_id: null, last_ping: null }).eq('id', targetSlotId);
    setIsModalOpen(false); setTargetSlotId(null); fetchSlots();
  };

  const handleEntry = async () => {
    if (!targetSlotId) return;
    await supabase.from('parking_slots').update({
      car_name: formData.name, customer_name: formData.customerName, color: formData.color, status: formData.status,
      plate: formData.plate, car_manager: formData.carManager, entry_manager: formData.entryManager, 
      entry_date: formData.entryDate, memo: formData.memo, editing_id: null, last_ping: null
    }).eq('id', targetSlotId);
    setIsModalOpen(false); setTargetSlotId(null); fetchSlots();
  };

  const renderSlot = (slot: Slot) => {
    const isEditing = slot.editing_id !== null && !isLockExpired(slot.last_ping);
    const isLockedByOther = isEditing && slot.editing_id !== myId;
    const isMoveSource = moveSourceId === slot.id;
    const isSelected = selectedIds.includes(slot.id);
    const isHighlighted = (filterManager || filterStatus) && (!filterManager || slot.car?.carManager === filterManager) && (!filterStatus || slot.car?.status === filterStatus) && slot.car;

    let bgColor = '#fff';
    if (isLockedByOther) bgColor = '#ffe5e5';
    else if (isMoveSource) bgColor = '#ffc107';
    else if (isSelected) bgColor = '#fff3cd';
    else if (isHighlighted) bgColor = '#e3f2fd';

    return (
      <div key={slot.id} 
        onClick={() => {
          if (isMoveMode) {
             if (!moveSourceId && slot.car) setMoveSourceId(slot.id);
             else if (moveSourceId) (moveSourceId === slot.id) ? setMoveSourceId(null) : handleMove(slot.id);
          } else if (isSelectionMode) {
            setSelectedIds(prev => isSelected ? prev.filter(id => id !== slot.id) : [...prev, slot.id]);
          } else { openForm(slot); }
        }}
        style={{
          minHeight: '80px', borderRadius: '4px', border: '1px solid #ccc', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: '4px', position: 'relative',
          backgroundColor: bgColor,
          borderColor: isLockedByOther ? '#dc3545' : (slot.car ? '#007bff' : '#ccc'),
          opacity: (filterManager || filterStatus) && !isHighlighted ? 0.3 : 1
        }}
      >
        {isLockedByOther && (
          <button onClick={(e) => handleForceUnlock(e, slot.id)} style={{ position: 'absolute', top: '-8px', right: '-8px', backgroundColor: '#dc3545', color: '#fff', border: 'none', borderRadius: '50%', width: '20px', height: '20px', fontSize: '12px', zIndex: 10 }}>×</button>
        )}
        <span style={{ fontSize: '10px', color: '#888' }}>{slot.label}</span>
        {slot.car?.customerName && <span style={{ fontSize: '10px' }}>{slot.car.customerName} 様</span>}
        <span style={{ fontWeight: 'bold', fontSize: '13px', textAlign: 'center' }}>{isLockedByOther ? '入力中' : (slot.car?.name || '')}</span>
        {slot.car && !isLockedByOther && <span style={{ color: '#007bff', fontSize: '10px' }}>{slot.car.status}</span>}
      </div>
    );
  };

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <img src="/logo.png" alt="Loading..." style={{ width: '150px' }} />
    </div>
  );

  return (
    <div style={{ backgroundColor: '#fff', minHeight: '100vh', width: '100%', padding: '10px' }}>
      <h1 style={{ fontSize: '18px', textAlign: 'center', marginBottom: '10px' }}>拠点別駐車場管理</h1>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '5px', marginBottom: '15px' }}>
        {AREAS.map(area => (
          <button key={area} onClick={() => { setCurrentArea(area); setSelectedIds([]); setMoveSourceId(null); }} 
            style={{ padding: '6px 12px', fontSize: '13px', border: '1px solid #ddd', backgroundColor: currentArea === area ? '#333' : '#fff', color: currentArea === area ? '#fff' : '#333' }}>
            {area}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '5px', marginBottom: '10px' }}>
        <select value={filterManager} onChange={e => setFilterManager(e.target.value)} style={{ padding: '4px', fontSize: '12px', width: '100px' }}><option value="">担当者</option>{STAFF_LIST.map(n => <option key={n} value={n}>{n}</option>)}</select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: '4px', fontSize: '12px', width: '100px' }}><option value="">状況</option>{STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}</select>
        <button onClick={() => { setFilterManager(''); setFilterStatus(''); }} style={{ fontSize: '12px' }}>解除</button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '20px' }}>
        <button onClick={() => { setIsMoveMode(!isMoveMode); setIsSelectionMode(false); }} style={{ padding: '5px 15px', backgroundColor: isMoveMode ? '#ffc107' : '#eee', border: '1px solid #ccc', fontSize: '13px' }}>移動</button>
        <button onClick={() => { setIsSelectionMode(!isSelectionMode); setIsMoveMode(false); }} style={{ padding: '5px 15px', backgroundColor: isSelectionMode ? '#dc3545' : '#eee', color: isSelectionMode ? '#fff' : '#333', border: '1px solid #ccc', fontSize: '13px' }}>削除</button>
      </div>

      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        {currentArea === '極上仕上場' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
            {[
              { label: "東エリア", keyword: "東", cols: 4 },
              { label: "西エリア", keyword: "西", cols: 2 },
              { label: "ポート", keyword: "ポート", cols: 3 },
              { label: "スタジオ / 掃除スペース", keyword: ["スタジオ", "掃除スペース"], cols: 2 },
              { label: "予備", keyword: "予備", cols: 4 }
            ].map(section => {
              const sectionSlots = displaySlots.filter(s => Array.isArray(section.keyword) ? section.keyword.some(k => s.label.includes(k)) : s.label.includes(section.keyword)).sort((a, b) => a.label.localeCompare(b.label, 'ja', {numeric: true}));
              if (sectionSlots.length === 0) return null;
              return (
                <div key={section.label}>
                  <h3 style={{ fontSize: '14px', marginBottom: '8px', borderLeft: '3px solid #333', paddingLeft: '8px' }}>{section.label}</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${section.cols}, 1fr)`, gap: '8px' }}>
                    {sectionSlots.map(slot => renderSlot(slot))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : currentArea === '裏駐車場' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1fr 1fr 1.8fr', gap: '8px' }}>
              {displaySlots.filter(s => !s.label.includes('入口')).map(slot => renderSlot(slot))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', width: '40%' }}>
              {displaySlots.filter(s => s.label.includes('入口')).map(slot => renderSlot(slot))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {displaySlots.map(slot => renderSlot(slot))}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#fff', padding: '20px', width: '90%', maxWidth: '400px', borderRadius: '8px' }}>
            <h2 style={{ fontSize: '16px', marginBottom: '15px' }}>{slots.find(s => s.id === targetSlotId)?.label} 情報入力</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input type="text" placeholder="車名" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={{ padding: '8px' }} />
              <input type="text" placeholder="お客様名" value={formData.customerName} onChange={e => setFormData({...formData, customerName: e.target.value})} style={{ padding: '8px' }} />
              <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} style={{ padding: '8px' }}><option value="">状況を選択</option>{STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}</select>
              <select value={formData.carManager} onChange={e => setFormData({...formData, carManager: e.target.value})} style={{ padding: '8px' }}><option value="">担当者</option>{STAFF_LIST.map(n => <option key={n} value={n}>{n}</option>)}</select>
              <button onClick={() => setFormData({...formData, entryDate: getNowTimestamp()})} style={{ padding: '8px', backgroundColor: '#f0f0f0' }}>入庫打刻</button>
              <textarea placeholder="備考" value={formData.memo} onChange={e => setFormData({...formData, memo: e.target.value})} style={{ padding: '8px', height: '60px' }} />
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button onClick={handleEntry} style={{ flex: 1, padding: '10px', backgroundColor: '#007bff', color: '#fff', border: 'none' }}>保存</button>
                <button onClick={closeModal} style={{ flex: 1, padding: '10px', backgroundColor: '#ccc', border: 'none' }}>キャンセル</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;