import React, { useState, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { 
  UploadCloud, Calendar, Share2, FileSpreadsheet, Trash2, Smartphone, 
  Users, BarChart3, X, Download, Save, ChevronRight, UserPlus, 
  Settings2, Fingerprint, Map, Table, Zap, Briefcase, Edit2, History
} from 'lucide-react';
import { format, addDays, getDay, startOfMonth, getDaysInMonth } from 'date-fns';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

type RowData = Record<string, string | number>;

// Utility functions
const isNameOrId = (col: string) => /id|name|no\.|serial|sn|designation/i.test(col);
const getDateColumns = (cols: string[]) => cols.filter(c => !isNameOrId(c) && c !== '_uid' && c.trim() !== '');

const getSN = (row: RowData, cols: string[]) => {
  const key = cols.find(k => /sn|serial/i.test(k)) || Object.keys(row).find(k => /sn|serial/i.test(k));
  return key ? String(row[key] || '').trim() : '';
};

const getName = (row: RowData, cols: string[]) => {
  const key = cols.find(k => /name|identity/i.test(k)) || Object.keys(row).find(k => /name|identity/i.test(k));
  return key ? String(row[key] || '').trim() : 'Unknown';
};

const getId = (row: RowData, cols: string[]) => {
  const key = cols.find(k => /id|no\./i.test(k) && !/name|identity/i.test(k)) || Object.keys(row).find(k => /id|no\./i.test(k) && !/name|identity/i.test(k));
  return key ? String(row[key] || '').trim() : '';
};

const getColumnWeight = (col: string) => {
  if (/sn|serial/i.test(col)) return 1;
  if (/id|no\./i.test(col) && !/name|identity/i.test(col)) return 2;
  if (/name|identity/i.test(col)) return 3;
  if (/designation/i.test(col)) return 4;
  return 5;
};

const generateUid = () => 'uid_' + Math.random().toString(36).substr(2, 9);

export interface AllocationRecord {
  id: string;
  staffUid: string;
  staffName: string;
  type: string;
  startDate: string;
  endDate: string;
  timestamp: number;
  previousValues: Record<string, string>;
}

export default function App() {
  const [data, setData] = useState<RowData[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<'daily'|'monthly'|'grid'|'manage'|'allocate'>('daily');
  
  const [allocations, setAllocations] = useState<AllocationRecord[]>([]);
  
  const isPastAllocation = (endDateStr: string) => {
     const today = new Date();
     today.setHours(0,0,0,0);
     
     // Robust parsing
     let d: Date;
     const clean = endDateStr.trim().replace(/[-/.,]/g, ' ');
     d = new Date(clean);
     
     // If incomplete date like "30 Apr", append current year
     if (isNaN(d.getTime())) {
        d = new Date(`${clean} ${today.getFullYear()}`);
     }
     
     if (isNaN(d.getTime())) return false; // Default to not past if we can't parse
     
     // Set to very end of the day to ensure it stays active/upcoming on that day
     d.setHours(23, 59, 59, 999);
     
     return d.getTime() < new Date().getTime();
  };

  // Allocate State
  const [allocStaffUid, setAllocStaffUid] = useState<string>('');
  const [allocType, setAllocType] = useState<string>('LEAVE');
  const [allocStart, setAllocStart] = useState<string>('');
  const [allocEnd, setAllocEnd] = useState<string>('');
  
  // Modals state
  const [editingStaff, setEditingStaff] = useState<RowData | null>(null);
  const [showAddDate, setShowAddDate] = useState(false);
  const [newDateInput, setNewDateInput] = useState('');

  // Automation state
  const [autoMonth, setAutoMonth] = useState<number>(new Date().getMonth());
  const [autoYear, setAutoYear] = useState<number>(new Date().getFullYear());
  const [autoShift, setAutoShift] = useState<string>('');
  const [autoWoDay, setAutoWoDay] = useState<number>(0); // 0 = Sunday

  // Grid filter state
  const [gridMonth, setGridMonth] = useState<number>(new Date().getMonth());
  const [gridYear, setGridYear] = useState<number>(new Date().getFullYear());

  const isColumnInMonth = (col: string, targetMonth: number, targetYear: number) => {
    const clean = col.toLowerCase().trim();
    if (/^\d{1,2}$/.test(clean)) return true;

    const monthAbbrs = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const fullMonthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    
    const targetAbbr = monthAbbrs[targetMonth];
    const targetFull = fullMonthNames[targetMonth];
    
    if (clean.includes(targetAbbr) || clean.includes(targetFull)) return true;
    
    const hasOtherMonth = monthAbbrs.some((abbr, idx) => idx !== targetMonth && clean.includes(abbr));
    if (hasOtherMonth) return false;

    const parts = clean.split(/[-/.]/);
    if (parts.length >= 2) {
      const targetMM = String(targetMonth + 1).padStart(2, '0');
      const targetM = String(targetMonth + 1);
      if (parts[1] === targetMM || parts[1] === targetM) return true;
      if (/^\d{1,2}$/.test(parts[1])) return false;
    }
    return true;
  };

  // Auto-suggestions values dynamically extracted
  const uniqueShifts = useMemo(() => {
    const shiftSet = new Set<string>();
    data.forEach(row => {
      getDateColumns(columns).forEach(c => {
        const val = String(row[c] || '').trim().toUpperCase();
        if (val) shiftSet.add(val);
      });
    });
    return Array.from(shiftSet).sort();
  }, [data, columns]);

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
       const snA = parseInt(getSN(a, columns), 10) || 0;
       const snB = parseInt(getSN(b, columns), 10) || 0;
       if (snA === 0 && snB === 0) return 0;
       return snA - snB;
    });
  }, [data, columns]);

  const getTomorrowDateMatch = (cols: string[]) => {
    const dCols = getDateColumns(cols);
    if (dCols.length === 0) return '';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const formats = [
      'dd-MMM', 'd-MMM', 'dd-MM', 'd-MM',
      'dd MMM', 'd MMM', 'dd/MM', 'd/MM',
      'dd MMMM', 'd MMMM', 'dd.MM', 'd.MM',
      'dd-MM-yyyy', 'd-MM-yyyy', 'dd/MM/yyyy', 'd/MM/yyyy',
      'yyyy-MM-dd'
    ];
    
    const tmStrs = formats.map(f => format(tomorrow, f).toLowerCase());

    // Find closest match or default back to first col
    const match = dCols.find(c => {
      const cleanCol = c.toLowerCase().trim();
      
      // If the column is just the day number (e.g. "24")
      if (/^\d{1,2}$/.test(cleanCol) && parseInt(cleanCol, 10) === tomorrow.getDate()) {
        return true;
      }
      
      if (tmStrs.some(ts => cleanCol.includes(ts))) return true;
      
      const day = format(tomorrow, 'd');
      const month = format(tomorrow, 'MMM').toLowerCase();
      // handle cases like "30th April", "30th Apr"
      if ((cleanCol.includes(day + 'th') || cleanCol.includes(day + 'st') || cleanCol.includes(day + 'nd') || cleanCol.includes(day + 'rd') || cleanCol.includes(day + ' ') || cleanCol.includes(day + '-')) && cleanCol.includes(month)) {
         return true;
      }
      
      return false;
    });
    
    return match || dCols[0];
  };

  // Load from LocalStorage for persistence on mobile
  useEffect(() => {
    try {
      const savedData = localStorage.getItem('shiftData');
      const savedCols = localStorage.getItem('shiftCols');
      const savedFile = localStorage.getItem('shiftFileName');
      if (savedData && savedCols) {
        const pCols = JSON.parse(savedCols);
        setData(JSON.parse(savedData));
        setColumns(pCols);
        setSelectedDate(getTomorrowDateMatch(pCols));
        if (savedFile) setFileName(savedFile);
      }
      const savedAlloc = localStorage.getItem('shiftAllocations');
      if (savedAlloc) {
        setAllocations(JSON.parse(savedAlloc));
      }
    } catch (e) {
      console.error('Failed to load local data');
    }
  }, []);

  const saveDataLocally = (newData: RowData[], newCols: string[], fname: string = fileName) => {
    setData(newData);
    setColumns(newCols);
    setFileName(fname);
    localStorage.setItem('shiftData', JSON.stringify(newData));
    localStorage.setItem('shiftCols', JSON.stringify(newCols));
    if (fname) localStorage.setItem('shiftFileName', fname);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fname = file.name;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      if (!bstr) return;

      const wb = XLSX.read(bstr, { type: 'binary', raw: false });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      
      const json = XLSX.utils.sheet_to_json<RowData>(ws, { defval: '' });
      
      if (json.length > 0) {
        const rawCols = Object.keys(json[0]);
        const processedData = json.map((row) => ({ ...row, _uid: generateUid() }));
        saveDataLocally(processedData, rawCols, fname);
        setSelectedDate(getTomorrowDateMatch(rawCols));
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleClear = () => {
    if (!window.confirm("Are you sure you want to clear all data and reset the schedule?")) return;
    setData([]);
    setColumns([]);
    setFileName('');
    setSelectedDate('');
    setAllocations([]);
    setAllocStaffUid('');
    setAllocStart('');
    setAllocEnd('');
    localStorage.removeItem('shiftData');
    localStorage.removeItem('shiftCols');
    localStorage.removeItem('shiftFileName');
    localStorage.removeItem('shiftAllocations');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAddAllocation = () => {
      if(!allocStaffUid || !allocType || !allocStart || !allocEnd) return;
      
      const dList = getDateColumns(columns);
      const startIdx = dList.indexOf(allocStart);
      const endIdx = dList.indexOf(allocEnd);
      if(startIdx === -1 || endIdx === -1) return;
      
      const minIdx = Math.min(startIdx, endIdx);
      const maxIdx = Math.max(startIdx, endIdx);
      const targetDates = dList.slice(minIdx, maxIdx + 1);

      const staffRow = data.find(d => d._uid === allocStaffUid);
      if(!staffRow) return;

      const previousValues: Record<string, string> = {};
      targetDates.forEach(d => {
          previousValues[d] = String(staffRow[d] || '');
      });

      const newAlloc: AllocationRecord = {
          id: generateUid(),
          staffUid: allocStaffUid,
          staffName: getName(staffRow, columns),
          type: allocType,
          startDate: dList[minIdx],
          endDate: dList[maxIdx],
          timestamp: Date.now(),
          previousValues
      };

      const newData = data.map(row => {
          if(row._uid === allocStaffUid) {
              const updated = { ...row };
              targetDates.forEach(d => {
                  updated[d] = allocType;
              });
              return updated;
          }
          return row;
      });

      const updatedAllocs = [newAlloc, ...allocations];
      setAllocations(updatedAllocs);
      localStorage.setItem('shiftAllocations', JSON.stringify(updatedAllocs));
      saveDataLocally(newData, columns);
      
      setAllocStaffUid('');
      setAllocStart('');
      setAllocEnd('');
  };

  const handleDeleteAllocation = (allocId: string, skipConfirm = false) => {
      const alloc = allocations.find(a => a.id === allocId);
      if(!alloc) return;

      if (!skipConfirm && !window.confirm("Are you sure you want to delete this allocation log and restore previous shift values?")) return;

      const staffExists = data.some(d => d._uid === alloc.staffUid);
      let newData = data;
      if (staffExists) {
          newData = data.map(row => {
              if(row._uid === alloc.staffUid) {
                  const updated = { ...row };
                  Object.keys(alloc.previousValues).forEach(d => {
                      updated[d] = alloc.previousValues[d];
                  });
                  return updated;
              }
              return row;
          });
      }

      const updatedAllocs = allocations.filter(a => a.id !== allocId);
      setAllocations(updatedAllocs);
      localStorage.setItem('shiftAllocations', JSON.stringify(updatedAllocs));
      saveDataLocally(newData, columns);
  };

  const [editingAlloc, setEditingAlloc] = useState<AllocationRecord | null>(null);
  const [editAllocType, setEditAllocType] = useState<string>('');
  const [editAllocStart, setEditAllocStart] = useState<string>('');
  const [editAllocEnd, setEditAllocEnd] = useState<string>('');

  const handleEditAllocation = (allocId: string) => {
      const alloc = allocations.find(a => a.id === allocId);
      if(!alloc) return;
      setEditingAlloc(alloc);
      setEditAllocType(alloc.type);
      setEditAllocStart(alloc.startDate);
      setEditAllocEnd(alloc.endDate);
  };

  const handleSaveEditAllocation = () => {
      if(!editingAlloc || !editAllocType || !editAllocStart || !editAllocEnd) return;
      
      const dList = getDateColumns(columns);
      const startIdx = dList.indexOf(editAllocStart);
      const endIdx = dList.indexOf(editAllocEnd);
      if(startIdx === -1 || endIdx === -1) return;
      
      const minIdx = Math.min(startIdx, endIdx);
      const maxIdx = Math.max(startIdx, endIdx);
      const targetDates = dList.slice(minIdx, maxIdx + 1);

      // First, restore old allocation's previous values
      let newData = data.map(row => {
         if (row._uid === editingAlloc.staffUid) {
            const updated = { ...row };
            Object.keys(editingAlloc.previousValues).forEach(d => {
                updated[d] = editingAlloc.previousValues[d];
            });
            return updated;
         }
         return row;
      });

      // Now apply new allocation over updated data
      const previousValues: Record<string, string> = {};
      newData = newData.map(row => {
          if(row._uid === editingAlloc.staffUid) {
              const updated = { ...row };
              targetDates.forEach(d => {
                  previousValues[d] = updated[d] ? String(updated[d]) : '';
                  updated[d] = editAllocType === '-' ? '' : editAllocType;
              });
              return updated;
          }
          return row;
      });

      const newAlloc: AllocationRecord = {
          ...editingAlloc,
          type: editAllocType,
          startDate: dList[minIdx],
          endDate: dList[maxIdx],
          timestamp: Date.now(), // update timestamp so it goes to top of active logs, or keep old? Update so we know it was modified.
          previousValues
      };

      const updatedAllocs = allocations.map(a => a.id === editingAlloc.id ? newAlloc : a).sort((a,b) => b.timestamp - a.timestamp);
      setAllocations(updatedAllocs);
      localStorage.setItem('shiftAllocations', JSON.stringify(updatedAllocs));
      
      saveDataLocally(newData, columns);
      setEditingAlloc(null);
  };

  const dateList = useMemo(() => getDateColumns(columns), [columns]);

  const filteredGridDates = useMemo(() => {
    return dateList.filter(d => isColumnInMonth(d, gridMonth, gridYear));
  }, [dateList, gridMonth, gridYear]);

  const gridStats = useMemo(() => {
    const stats: Record<string, { totalWorking: number, breakdown: Record<string, number> }> = {};
    dateList.forEach(date => {
       let totalWorking = 0;
       let breakdown: Record<string, number> = {};
       
       data.forEach(row => {
          const val = String(row[date] || '').trim().toUpperCase();
          if (!val || val === '-' || val === 'NOT ASSIGNED' || val === 'NA') return;
          
          const isOff = ['WO', 'OFF', 'C/OFF', 'LEAVE', 'PL', 'CL', 'SL', 'TR', 'TRAIN'].some(skip => val.includes(skip));
          
          if (!isOff) {
             totalWorking++;
             let cleanVal = val.replace(/P1:|P2:/g, '').trim();
             if(!cleanVal) cleanVal = val;
             breakdown[cleanVal] = (breakdown[cleanVal] || 0) + 1;
          }
       });
       
       stats[date] = { totalWorking, breakdown };
    });
    return stats;
  }, [data, dateList]);

  // Daily View Aggregation
  const shifts = useMemo(() => {
    if (!selectedDate || !data.length) return {};
    const grouped: Record<string, RowData[]> = {};
    data.forEach(row => {
      let shiftValue = String(row[selectedDate] || '').trim();
      if (!shiftValue || shiftValue === '-' || shiftValue.toLowerCase() === 'na') {
        shiftValue = 'Not Assigned';
      }
      
      const name = getName(row, columns);
      if ((!name || name === 'Unknown') && !getId(row, columns)) return;
      
      if (!grouped[shiftValue]) grouped[shiftValue] = [];
      grouped[shiftValue].push(row);
    });

    Object.keys(grouped).forEach(key => {
      grouped[key].sort((a, b) => {
        const snA_str = String(getSN(a, columns)).replace(/\D/g, '');
        const snB_str = String(getSN(b, columns)).replace(/\D/g, '');
        const snA = parseInt(snA_str, 10);
        const snB = parseInt(snB_str, 10);
        const validA = !isNaN(snA) ? snA : Number.MAX_SAFE_INTEGER;
        const validB = !isNaN(snB) ? snB : Number.MAX_SAFE_INTEGER;
        return validA - validB;
      });
    });

    return grouped;
  }, [data, selectedDate, columns]);

  const generateWhatsAppText = () => {
    let text = `*SECURITY FORCE PLANNING FOR ${selectedDate.toUpperCase()}*\n\n`;
    
    // Categorize shifts into Working vs Leaves/Offs
    const offCategories = ['WO', 'OFF', 'C/OFF', 'COFF', 'LEAVE', 'PL', 'CL', 'SL', 'TR', 'TRAIN', 'TRAINING'];
    const isOffCategory = (shift: string) => offCategories.some(skip => shift.toUpperCase().includes(skip));

    const workingShifts: string[] = [];
    const leaveShifts: string[] = [];

    Object.keys(shifts).forEach(shift => {
      const s = shift.toUpperCase();
      if (s === 'NOT ASSIGNED' || s === '-' || s === 'NA') return;
      if (isOffCategory(s)) {
         leaveShifts.push(shift);
      } else {
         workingShifts.push(shift);
      }
    });

    workingShifts.sort((a,b) => a.localeCompare(b));
    leaveShifts.sort((a,b) => a.localeCompare(b));

    workingShifts.forEach(shift => {
      const shiftUpper = shift.toUpperCase();
      const shiftName = shiftUpper.startsWith('SHIFT') ? shiftUpper : `SHIFT ${shiftUpper}`;
      text += `${shiftName}\n\n`;
      shifts[shift].forEach((emp, index) => {
        text += `${index + 1}. ${getName(emp, columns)}\n`;
      });
      text += `\n`;
    });

    leaveShifts.forEach(shift => {
      text += `${shift.toUpperCase()}\n`;
      shifts[shift].forEach((emp, index) => {
        text += `${index + 1}. ${getName(emp, columns)}\n`;
      });
      text += `\n`;
    });

    return encodeURIComponent(text.trim());
  };

  const handleShare = () => {
    if (!selectedDate) return;
    window.location.href = `https://wa.me/?text=${generateWhatsAppText()}`;
  };

  const handleExport = async () => {
    const exportData = data.map(row => {
      const { _uid, ...rest } = row;
      return rest;
    });
    const ws = XLSX.utils.json_to_sheet(exportData, { header: columns });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Roster");
    
    if (Capacitor.isNativePlatform()) {
      try {
        const base64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
        const path = `Roster_Export_${Date.now()}.xlsx`;
        const result = await Filesystem.writeFile({
          path,
          data: base64,
          directory: Directory.Cache
        });
        await Share.share({
          title: 'Exported Roster',
          text: 'Here is the exported roster.',
          url: result.uri,
        });
      } catch (error) {
        console.error("Native export failed", error);
        XLSX.writeFile(wb, "Updated_Roster.xlsx");
      }
    } else {
      XLSX.writeFile(wb, "Updated_Roster.xlsx");
    }
  };

  const handleExportDB = async () => {
    const backup = { data, columns, allocations, fileName };
    const content = JSON.stringify(backup, null, 2);
    
    if (Capacitor.isNativePlatform()) {
      try {
        const path = `shiftpro_backup_${Date.now()}.json`;
        const result = await Filesystem.writeFile({
          path,
          data: content,
          directory: Directory.Cache,
          encoding: Encoding.UTF8
        });
        await Share.share({
          title: 'ShiftPro Backup',
          text: 'Sharing ShiftPro Database Backup',
          url: result.uri,
        });
      } catch (error) {
        console.error("Native backup export failed", error);
        fallbackWebExportDB(content);
      }
    } else {
      fallbackWebExportDB(content);
    }
  };

  const fallbackWebExportDB = (content: string) => {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    if (navigator.share) {
      const file = new File([blob], "shiftpro_backup.json", { type: "application/json" });
      navigator.share({ 
        files: [file], 
        title: "ShiftPro Backup",
        text: "Sharing ShiftPro Database Backup" 
      }).catch(err => {
        console.error("Share failed", err);
        const a = document.createElement('a'); a.href = url; a.download = "shiftpro_backup.json"; a.click();
      });
    } else {
      const a = document.createElement('a'); a.href = url; a.download = "shiftpro_backup.json"; a.click();
    }
  };

  const handleImportDB = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const content = evt.target?.result as string;
        const backup = JSON.parse(content);
        if (backup && backup.data && backup.columns) {
          setData(backup.data);
          setColumns(backup.columns);
          if (backup.fileName) setFileName(backup.fileName);
          if (backup.allocations) setAllocations(backup.allocations);
          
          localStorage.setItem('shiftData', JSON.stringify(backup.data));
          localStorage.setItem('shiftCols', JSON.stringify(backup.columns));
          localStorage.setItem('shiftAllocations', JSON.stringify(backup.allocations || []));
          if (backup.fileName) localStorage.setItem('shiftFileName', backup.fileName);
          
          setSelectedDate(getTomorrowDateMatch(backup.columns));
          alert("Database imported successfully!");
        } else {
          alert("Invalid backup file format.");
        }
      } catch (err) {
        alert("Failed to parse JSON backup.");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleAddDateSave = () => {
    if (!newDateInput.trim()) return;
    const dateStr = newDateInput.trim();
    if (columns.includes(dateStr)) {
      alert("This date already exists.");
      return;
    }
    const newCols = [...columns, dateStr];
    const newData = data.map(row => ({...row, [dateStr]: ''}));
    saveDataLocally(newData, newCols);
    setShowAddDate(false);
    setNewDateInput('');
    setSelectedDate(dateStr);
  };

  // Grid Inline Editing
  const handleInlineEdit = (uid: string, field: string, value: string) => {
    const newData = data.map(row => {
      if (row._uid === uid) {
        return { ...row, [field]: value };
      }
      return row;
    });
    saveDataLocally(newData, columns);
  };

  // Automation / Auto-Fill Logic
  const handleAutoFill = () => {
    if (!editingStaff) return;
    const start = startOfMonth(new Date(autoYear, autoMonth));
    const daysInMonth = getDaysInMonth(start);
    const newStaff = { ...editingStaff };
    
    for (let i = 0; i < daysInMonth; i++) {
       const currentDate = addDays(start, i);
       // Format: DD-MMM (e.g., 01-May)
       const dateStr = format(currentDate, "dd-MMM");
       
       if (getDay(currentDate) === autoWoDay) {
           newStaff[dateStr] = 'WO';
       } else {
           newStaff[dateStr] = autoShift;
       }
    }
    setEditingStaff(newStaff);
  };

  const handleCommitProfileChanges = () => {
    if (!editingStaff) return;
    
    // Auto-detect new columns added by automation
    const newColsSet = new Set(columns);
    Object.keys(editingStaff).forEach(k => {
      if (k !== '_uid') newColsSet.add(k);
    });
    const newColsArr = Array.from(newColsSet) as string[];
    
    let isNew = !data.find(d => d._uid === editingStaff._uid);
    let freshData = isNew 
        ? [editingStaff, ...data] 
        : data.map(d => d._uid === editingStaff._uid ? editingStaff : d);
        
    saveDataLocally(freshData, newColsArr);
    setEditingStaff(null);
  };

  const [activeSearch, setActiveSearch] = useState({ id: '', val: '' });

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-200 pb-28 font-sans selection:bg-cyan-500/30">
      
      {/* Hidden Datalists for autocomplete */}
      <datalist id="shift-suggestions">
        {uniqueShifts
          .filter(s => !activeSearch.val || s.toLowerCase().includes(activeSearch.val.toLowerCase()))
          .map(s => <option key={s} value={s} />)}
      </datalist>
      {columns.map(col => {
         const uniqueVals = Array.from(new Set(data.map(r => String(r[col] || '').trim()).filter(Boolean)));
         const safeId = col.replace(/[^a-zA-Z0-9]/g, '-');
         const isCurrent = activeSearch.id === `suggestions-${safeId}`;
         const filteredVals = isCurrent && activeSearch.val 
           ? uniqueVals.filter(v => v.toLowerCase().includes(activeSearch.val.toLowerCase()))
           : uniqueVals;

         return (
           <datalist key={`list-${col}`} id={`suggestions-${safeId}`}>
             {filteredVals.map(v => <option key={v} value={v} />)}
           </datalist>
         );
      })}

      {/* Top App Header */}
      <header className="sticky top-0 z-20 px-5 py-4 flex items-center justify-between border-b border-white/10 bg-[#09090b]/80 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 p-[1px] shadow-[0_0_15px_rgba(34,211,238,0.2)]">
            <div className="w-full h-full bg-[#09090b] rounded-[15px] flex items-center justify-center">
              <Settings2 className="w-5 h-5 text-cyan-400" />
            </div>
          </div>
          <div>
            <h1 className="text-lg font-display font-bold tracking-wide text-zinc-100">SHIFT<span className="text-cyan-400">PRO</span></h1>
            {fileName && <p className="text-[10px] text-zinc-500 font-mono tracking-wider max-w-[150px] truncate">{fileName}</p>}
          </div>
        </div>
        
        {data.length > 0 && (
          <button onClick={handleClear} className="w-10 h-10 rounded-xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-rose-400 hover:border-rose-400/50 transition-all active:scale-95" aria-label="Clear Data">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </header>

      <main className="max-w-xl mx-auto px-4 py-6">
        {activeTab !== 'manage' && data.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto bg-zinc-900 border border-white/5 rounded-2xl flex items-center justify-center mb-4">
              <FileSpreadsheet className="w-8 h-8 text-zinc-500" />
            </div>
            <h3 className="text-zinc-300 font-bold mb-2">No Routine Found</h3>
            <p className="text-zinc-500 text-sm max-w-xs mx-auto">Go to the Profile tab to mount your Excel source file and populate the roster.</p>
          </div>
        ) : (
          <>
            {/* -------------------- DAILY TAB -------------------- */}
            <div className={`transition-opacity duration-300 ${activeTab === 'daily' ? 'opacity-100 block' : 'opacity-0 hidden'}`}>
              <div className="mb-8">
                 <label className="block text-[10px] font-mono text-cyan-400 uppercase tracking-widest mb-3 ml-2">Temporal Node</label>
                 <div className="relative group">
                   <select 
                     value={selectedDate}
                     onChange={(e) => setSelectedDate(e.target.value)}
                     className="w-full pl-14 pr-12 py-4 bg-zinc-900 border border-white/10 rounded-2xl font-mono text-sm text-zinc-100 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 appearance-none shadow-inner outline-none transition-all"
                   >
                     {dateList.length === 0 && <option value="">No nodes available</option>}
                     {dateList.map(d => <option key={d} value={d}>{d}</option>)}
                   </select>
                   <div className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg bg-zinc-800 flex items-center justify-center">
                    <Calendar className="w-3.5 h-3.5 text-zinc-400" />
                   </div>
                   <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                     <ChevronRight className="w-5 h-5 text-zinc-500 rotate-90" />
                   </div>
                 </div>
              </div>

              {selectedDate && (
                <div className="space-y-4">
                  {Object.keys(shifts).sort((a,b) => (a==='Not Assigned'?1:(b==='Not Assigned'?-1:a.localeCompare(b)))).map(shiftName => {
                    const emps = shifts[shiftName];
                    const sl = shiftName.toLowerCase();
                    
                    // Specific Color Mapping based on new requirements
                    let accentLine = "border-l-zinc-700";
                    let bgBox = "bg-zinc-900/50";
                    let accentText = "text-zinc-100";
                    let badgeStyles = "bg-zinc-800 text-zinc-400 border border-white/5";

                    if (sl === 'am' || sl.includes('am shift')) {
                      accentLine = "border-l-blue-400 shadow-[-5px_0_15px_-5px_rgba(96,165,250,0.3)]"; 
                      bgBox = "bg-gradient-to-r from-blue-950/20 to-zinc-900/50";
                      accentText = "text-blue-400"; 
                      badgeStyles = "bg-blue-500/10 border border-blue-500/20 text-blue-400"; 
                    } else if (sl.includes('p1') || sl.includes('morn')) { 
                      accentLine = "border-l-cyan-400 shadow-[-5px_0_15px_-5px_rgba(34,211,238,0.3)]"; 
                      bgBox = "bg-gradient-to-r from-cyan-950/20 to-zinc-900/50";
                      accentText = "text-cyan-400"; 
                      badgeStyles = "bg-cyan-500/10 border border-cyan-500/20 text-cyan-400"; 
                    } else if (sl.includes('p2') || sl.includes('even')) { 
                      accentLine = "border-l-indigo-400 shadow-[-5px_0_15px_-5px_rgba(99,102,241,0.3)]"; 
                      bgBox = "bg-gradient-to-r from-indigo-950/20 to-zinc-900/50";
                      accentText = "text-indigo-400"; 
                      badgeStyles = "bg-indigo-500/10 border border-indigo-500/20 text-indigo-400"; 
                    } else if (sl.includes('leave') || sl.includes('pl') || sl.includes('cl') || sl.includes('sl')) { 
                      accentLine = "border-l-rose-500 shadow-[-5px_0_15px_-5px_rgba(244,63,94,0.3)]"; 
                      bgBox = "bg-gradient-to-r from-rose-950/20 to-zinc-900/50";
                      accentText = "text-rose-400"; 
                      badgeStyles = "bg-rose-500/10 border border-rose-500/20 text-rose-400"; 
                    } else if (sl.includes('wo') || sl.includes('off') || sl.includes('c/off')) { 
                      accentLine = "border-l-amber-500 shadow-[-5px_0_15px_-5px_rgba(245,158,11,0.3)]"; 
                      bgBox = "bg-gradient-to-r from-amber-950/20 to-zinc-900/50";
                      accentText = "text-amber-400"; 
                      badgeStyles = "bg-amber-500/10 border border-amber-500/20 text-amber-400"; 
                    } else if (sl.includes('tr') || sl.includes('train')) { 
                      accentLine = "border-l-fuchsia-500 shadow-[-5px_0_15px_-5px_rgba(217,70,239,0.3)]"; 
                      bgBox = "bg-gradient-to-r from-fuchsia-950/20 to-zinc-900/50";
                      accentText = "text-fuchsia-400"; 
                      badgeStyles = "bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-400"; 
                    } else if (sl.includes('executive') || sl.includes('officer')) {
                      accentLine = "border-l-emerald-400 shadow-[-5px_0_15px_-5px_rgba(52,211,153,0.3)]"; 
                      bgBox = "bg-gradient-to-r from-emerald-950/20 to-zinc-900/50";
                      accentText = "text-emerald-400"; 
                      badgeStyles = "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"; 
                    }

                    return (
                      <div key={shiftName} className={`rounded-2xl border border-white/10 overflow-hidden border-l-[3px] ${accentLine} ${bgBox} backdrop-blur-md`}>
                        <div className="px-5 py-4 border-b border-white/5 flex justify-between items-center bg-zinc-950/30">
                          <h3 className={`font-display font-bold tracking-wide ${accentText}`}>
                             {shiftName.toUpperCase() === 'AM' ? 'ASSISTANT MANAGER' : shiftName.toUpperCase()}
                          </h3>
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold ${badgeStyles}`}>
                            {String(emps.length).padStart(2, '0')} UNIT{emps.length !== 1 ? 'S' : ''}
                          </span>
                        </div>
                        <ul className="divide-y divide-white/5">
                          {emps.map((emp, i) => (
                            <li key={i} className="px-5 py-3.5 flex items-center justify-between hover:bg-white/5 transition-colors group">
                              <div className="flex items-center gap-4">
                                <div className="w-8 h-8 rounded-full bg-zinc-800 border border-white/5 flex items-center justify-center text-xs font-mono text-zinc-500 group-hover:border-zinc-600 transition-colors">
                                  {String(i + 1).padStart(2, '0')}
                                </div>
                                <div>
                                  <p className="font-semibold text-zinc-200 text-sm">{getName(emp, columns)}</p>
                                  {getId(emp, columns) && (
                                    <div className="flex items-center gap-1.5 mt-1">
                                      <Fingerprint className="w-3 h-3 text-zinc-600" />
                                      <p className="text-[10px] text-zinc-500 font-mono tracking-wider">{getId(emp, columns)}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
              
              {selectedDate && Object.keys(shifts).length > 0 && (
                <div className="fixed bottom-24 left-0 right-0 flex justify-center z-20 pointer-events-none px-4">
                  <button 
                    onClick={handleShare} 
                    className="pointer-events-auto w-full max-w-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-[0_0_20px_rgba(16,185,129,0.3)] shadow-emerald-500/20 py-4 rounded-2xl font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-3 active:scale-[0.98] transition-all"
                  >
                    <Share2 className="w-4 h-4" /><span>Dispatch to WhatsApp</span>
                  </button>
                </div>
              )}
            </div>

            {/* -------------------- MONTHLY TAB -------------------- */}
            <div className={`transition-opacity duration-300 ${activeTab === 'monthly' ? 'opacity-100 block' : 'opacity-0 hidden'}`}>
               <div className="flex items-center gap-3 mb-6 px-1">
                 <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                   <Map className="w-4 h-4 text-indigo-400" />
                 </div>
                 <h2 className="text-xl font-display font-bold text-zinc-100">Summary Dashboard</h2>
               </div>
               
               <div className="grid gap-5">
                 {dateList.map(date => {
                   let counts = { p1: 0, p2: 0, am: 0, leave: 0, wo: 0, tr: 0, coff: 0, totalWorking: 0, total: 0 };
                   data.forEach(row => {
                     const v = String(row[date] || '').trim().toUpperCase();
                     if (v) counts.total++;
                     
                     // Determine if the person is available to work
                     // Any non-absence is considered working
                     const isWorking = v && !['WO', 'OFF', 'C/OFF', 'LEAVE', 'PL', 'CL', 'SL', 'TR', 'TRAIN'].some(skip => v.includes(skip));
                     if (isWorking) counts.totalWorking++;

                     if (v.includes('P1')) counts.p1++;
                     else if (v.includes('P2')) counts.p2++;
                     else if (v === 'AM') counts.am++;
                     else if (v === 'TR' || v.includes('TRAIN')) counts.tr++;
                     else if (v.includes('C/OFF')) counts.coff++;
                     else if (['LEAVE', 'PL', 'CL', 'SL'].includes(v) || v.includes('LEAVE')) counts.leave++;
                     else if (['WO', 'OFF'].includes(v) || v.includes('WO')) counts.wo++;
                   });

                   return (
                     <div key={date} className="bg-zinc-900 border border-white/5 p-5 rounded-2xl flex flex-col gap-4 relative overflow-hidden">
                       <div className="flex justify-between items-end border-b border-white/5 pb-3">
                         <h3 className="font-mono font-bold text-zinc-100 tracking-wider text-lg">[{date}]</h3>
                       </div>
                       
                       <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center shadow-[inset_0_0_20px_rgba(16,185,129,0.05)]">
                          <p className="text-[10px] text-emerald-400 font-mono tracking-widest uppercase mb-1">Total Manpower Available On Shift</p>
                          <p className="text-3xl font-display font-bold text-emerald-400">{counts.totalWorking}</p>
                       </div>

                       <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-4 text-center">
                          <p className="text-[10px] text-cyan-400 font-mono tracking-widest uppercase mb-1">P1 + P2 Count</p>
                          <p className="text-2xl font-display font-bold text-cyan-400">{counts.p1 + counts.p2}</p>
                          <div className="flex justify-center gap-6 mt-3 text-xs font-mono font-bold bg-black/30 p-2 rounded-lg mx-auto max-w-[200px] border border-white/5">
                            <span className="text-cyan-300">P1: <span className="text-cyan-100">{counts.p1}</span></span>
                            <span className="text-indigo-300">P2: <span className="text-indigo-100">{counts.p2}</span></span>
                          </div>
                       </div>

                       <div className="grid grid-cols-4 gap-2 text-[10px] font-mono tracking-widest uppercase text-center mt-2">
                         <div className="bg-zinc-950 border border-blue-500/10 p-2.5 rounded-xl flex flex-col items-center justify-center gap-1">
                           <span className="text-zinc-500">AM</span> 
                           <span className="text-blue-400 font-bold text-sm">{counts.am}</span>
                         </div>
                         <div className="bg-zinc-950 border border-amber-500/10 p-2.5 rounded-xl flex flex-col items-center justify-center gap-1">
                           <span className="text-zinc-500">WO</span> 
                           <span className="text-amber-400 font-bold text-sm">{counts.wo + counts.coff}</span>
                         </div>
                         <div className="bg-zinc-950 border border-rose-500/10 p-2.5 rounded-xl flex flex-col items-center justify-center gap-1">
                           <span className="text-zinc-500">LV</span> 
                           <span className="text-rose-400 font-bold text-sm">{counts.leave}</span>
                         </div>
                         <div className="bg-zinc-950 border border-fuchsia-500/10 p-2.5 rounded-xl flex flex-col items-center justify-center gap-1">
                           <span className="text-zinc-500">TR</span> 
                           <span className="text-fuchsia-400 font-bold text-sm">{counts.tr}</span>
                         </div>
                       </div>
                     </div>
                   );
                 })}
               </div>
            </div>

            {/* -------------------- GRID TAB -------------------- */}
            <div className={`transition-opacity duration-300 ${activeTab === 'grid' ? 'opacity-100 block' : 'opacity-0 hidden'}`}>
               <div className="flex items-center justify-between mb-6 px-1">
                 <div className="flex items-center gap-3">
                   <div className="w-8 h-8 rounded-xl bg-orange-500/20 border border-orange-500/30 flex items-center justify-center">
                     <Table className="w-4 h-4 text-orange-400" />
                   </div>
                   <h2 className="text-xl font-display font-bold text-zinc-100">Master Roster</h2>
                 </div>
                 <div className="flex items-center gap-2">
                   <select value={gridMonth} onChange={e=>setGridMonth(Number(e.target.value))} className="bg-zinc-900 border border-white/10 rounded-lg py-1.5 px-2 text-xs font-bold text-orange-200 outline-none focus:border-orange-500/50 appearance-none">
                     {Array.from({length: 12}).map((_, i) => <option key={i} value={i}>{format(new Date(2000, i, 1), 'MMM')}</option>)}
                   </select>
                   <select value={gridYear} onChange={e=>setGridYear(Number(e.target.value))} className="bg-zinc-900 border border-white/10 rounded-lg py-1.5 px-2 text-xs font-bold text-orange-200 outline-none focus:border-orange-500/50 appearance-none">
                     {Array.from({length: 10}).map((_, i) => {
                       const y = new Date().getFullYear() - 5 + i;
                       return <option key={y} value={y}>{y}</option>
                     })}
                   </select>
                 </div>
               </div>
               
               <p className="text-[10px] uppercase font-mono tracking-widest text-zinc-400 mb-4 px-1 leading-relaxed border-l-2 border-orange-500/50 pl-2">
                 Displaying columns for selected month. Scroll horizontally.
               </p>

               <div className="relative overflow-auto bg-zinc-900 border border-white/10 rounded-2xl h-[70vh] shadow-[0_0_30px_rgba(0,0,0,0.5)]">
                 {filteredGridDates.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-500 min-h-[300px]">
                       <Table className="w-12 h-12 mb-3 opacity-20" />
                       <p className="font-mono text-sm">No dates found for selected month.</p>
                       <p className="text-[10px] mt-1">If dates are stored simply as 1-31, verify their original format.</p>
                    </div>
                 ) : (
                 <table className="w-full text-left border-collapse text-sm">
                   <thead className="bg-zinc-950 sticky top-0 z-20">
                     <tr>
                       <th className="p-4 border-b border-r border-white/10 text-zinc-400 font-mono sticky left-0 bg-zinc-950 z-30 min-w-[150px]">Identity</th>
                       {filteredGridDates.map(d => (
                           <th key={d} className="p-4 border-b border-r border-white/10 text-cyan-400 font-mono whitespace-nowrap text-center text-xs tracking-wider min-w-[120px]">{d}</th>
                       ))}
                     </tr>
                   </thead>
                   <tbody>
                      {sortedData.map((row) => (
                         <tr key={row._uid} className="hover:bg-white/5 transition-colors group">
                            <td className="p-4 border-b border-r border-white/10 text-zinc-100 font-bold sticky left-0 bg-zinc-900 group-hover:bg-zinc-800 z-10 whitespace-nowrap transition-colors">
                               {getName(row, columns)}
                            </td>
                            {filteredGridDates.map(d => (
                               <td key={d} className="border-b border-r border-white/5 min-w-[120px] p-0 relative focus-within:z-20 h-[56px]">
                                  <input 
                                     list={String(row[d] || '').trim().length > 0 ? "shift-suggestions" : undefined}
                                     value={String(row[d] || '')}
                                     onChange={e => {
                                       handleInlineEdit(String(row._uid), d, e.target.value);
                                       setActiveSearch({ id: 'shift-suggestions', val: e.target.value });
                                     }}
                                     onFocus={() => setActiveSearch({ id: 'shift-suggestions', val: String(row[d] || '') })}
                                     className="absolute inset-0 w-full h-full pb-1 bg-transparent text-center font-bold text-indigo-300 outline-none focus:bg-indigo-500/20 focus:text-indigo-100 transition-all uppercase placeholder-zinc-800 focus:shadow-[inset_0_0_0_1px_rgba(99,102,241,0.5)]"
                                     placeholder="-"
                                     autoComplete="off"
                                  />
                               </td>
                            ))}
                         </tr>
                      ))}
                   </tbody>
                   <tfoot className="bg-zinc-950 sticky bottom-0 z-20 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
                     <tr>
                       <td className="p-4 border-t border-r border-white/10 text-emerald-400 font-mono font-bold sticky left-0 bg-zinc-950 z-30 uppercase text-xs tracking-widest border-b">
                         Total Available
                       </td>
                       {filteredGridDates.map(d => (
                         <td key={d} className="p-4 border-t border-r border-b border-white/10 text-emerald-400 font-display font-bold text-center text-lg bg-emerald-500/5">
                           {gridStats[d]?.totalWorking || 0}
                         </td>
                       ))}
                     </tr>
                     <tr>
                       <td className="p-4 border-r border-white/10 text-zinc-500 font-mono text-[10px] sticky left-0 bg-zinc-950 z-30 uppercase tracking-widest leading-relaxed">
                         Shift Breakdown
                       </td>
                       {filteredGridDates.map(d => {
                         const validEntries = Object.entries(gridStats[d]?.breakdown || {}) as [string, number][];
                         return (
                         <td key={'brk-'+d} className="p-2 border-r border-white/10 text-center align-top bg-zinc-950/50 min-h-[60px]">
                           <div className="flex flex-col gap-1 text-[9px] font-mono">
                             {validEntries
                               .sort((a, b) => b[1] - a[1])
                               .map(([shift, count]) => (
                               <div key={shift} className="flex justify-between items-center bg-white/5 px-2 py-1 rounded">
                                 <span className="text-zinc-400">{shift}</span>
                                 <span className="text-cyan-400 font-bold ml-2">{count}</span>
                               </div>
                             ))}
                           </div>
                         </td>
                       )})}
                     </tr>
                   </tfoot>
                 </table>
                 )}
               </div>
            </div>

            {/* -------------------- ALLOCATE TAB -------------------- */}
            <div className={`transition-opacity duration-300 ${activeTab === 'allocate' ? 'opacity-100 block' : 'opacity-0 hidden'}`}>
              <div className="flex items-center gap-3 mb-6 px-1">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                  <Briefcase className="w-4 h-4 text-emerald-400" />
                </div>
                <h2 className="text-xl font-display font-bold text-zinc-100">Leave Management</h2>
              </div>
              
              <div className="bg-zinc-900 border border-white/5 p-5 rounded-3xl shadow-[0_0_20px_rgba(0,0,0,0.3)] mb-8">
                <div className="grid gap-4">
                  <div>
                    <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block mb-1">Select Identity</label>
                    <select 
                      value={allocStaffUid}
                      onChange={e => setAllocStaffUid(e.target.value)}
                      className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm font-bold text-zinc-200 outline-none focus:border-emerald-500/50 appearance-none"
                    >
                      <option value="">-- Choose Staff --</option>
                      {data.map(emp => (
                        <option key={String(emp._uid)} value={String(emp._uid)}>
                          {getName(emp, columns)} {getId(emp, columns) ? `(${getId(emp, columns)})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block mb-1">Value / Type</label>
                    <select 
                      value={allocType}
                      onChange={e => setAllocType(e.target.value)}
                      className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm font-bold text-zinc-200 outline-none focus:border-emerald-500/50 appearance-none"
                    >
                      <option value="LEAVE">Leave (General)</option>
                      <option value="PL">Privilege Leave (PL)</option>
                      <option value="CL">Casual Leave (CL)</option>
                      <option value="SL">Sick Leave (SL)</option>
                      <option value="TR">Training (TR)</option>
                      <option value="WO">Weekly Off (WO)</option>
                      <option value="C/OFF">Comp Off (C/OFF)</option>
                      <option value="-">Clear Value (-)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block mb-1">From Date</label>
                      <DatePicker 
                        selected={allocStart ? new Date(allocStart) : null}
                        onChange={(date: Date | null) => setAllocStart(date ? date.toISOString().split('T')[0] : '')}
                        dateFormat="yyyy-MM-dd"
                        className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm font-bold text-zinc-200 outline-none focus:border-emerald-500/50"
                        placeholderText="Select date"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block mb-1">To Date</label>
                      <DatePicker 
                        selected={allocEnd ? new Date(allocEnd) : null}
                        onChange={(date: Date | null) => setAllocEnd(date ? date.toISOString().split('T')[0] : '')}
                        dateFormat="yyyy-MM-dd"
                        className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm font-bold text-zinc-200 outline-none focus:border-emerald-500/50"
                        placeholderText="Select date"
                      />
                    </div>
                  </div>

                  <button 
                    onClick={handleAddAllocation}
                    disabled={!allocStaffUid || !allocStart || !allocEnd}
                    className="mt-2 w-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 py-3.5 rounded-xl font-bold uppercase tracking-widest text-xs active:bg-emerald-500/20 transition-all disabled:opacity-50 disabled:pointer-events-none"
                  >
                    Apply to Schedule
                  </button>
                </div>
              </div>

              <div className="space-y-6">
                 <div>
                    <h3 className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest mb-3 flex items-center justify-between">
                       <span>Upcoming / Active Logs</span>
                       <span className="bg-emerald-500/10 px-2 py-0.5 rounded-full">{allocations.filter(a => !isPastAllocation(a.endDate)).length}</span>
                    </h3>
                    {allocations.filter(a => !isPastAllocation(a.endDate)).length === 0 ? (
                      <div className="text-center py-6 bg-zinc-900 border border-white/5 rounded-2xl">
                        <p className="text-zinc-600 font-mono text-[10px]">No active range allocations.</p>
                      </div>
                    ) : (
                      <ul className="space-y-3">
                        {allocations.filter(a => !isPastAllocation(a.endDate)).map(alloc => (
                          <li key={alloc.id} className="bg-zinc-900 border border-emerald-500/10 rounded-2xl p-4 flex items-center justify-between shadow-[0_0_20px_rgba(0,0,0,0.3)]">
                            <div>
                               <p className="font-bold text-zinc-200 text-sm">{alloc.staffName}</p>
                               <div className="flex items-center gap-2 mt-1 font-mono text-[10px]">
                                  <span className="text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">{alloc.type}</span>
                                  <span className="text-zinc-500">{alloc.startDate} &rarr; {alloc.endDate}</span>
                               </div>
                            </div>
                            <div className="flex items-center gap-2">
                               <button 
                                 onClick={() => handleEditAllocation(alloc.id)}
                                 className="w-8 h-8 rounded-full bg-zinc-950 flex items-center justify-center text-zinc-500 hover:text-cyan-400 hover:bg-cyan-500/10 transition-all border border-white/5 active:scale-95"
                               >
                                  <Edit2 className="w-3.5 h-3.5" />
                               </button>
                               <button 
                                 onClick={() => handleDeleteAllocation(alloc.id)}
                                 className="w-8 h-8 rounded-full bg-zinc-950 flex items-center justify-center text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all border border-white/5 active:scale-95"
                               >
                                  <Trash2 className="w-3.5 h-3.5" />
                               </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                 </div>

                 <div>
                    <h3 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-3 flex items-center justify-between">
                       <span>Past Logs</span>
                       <span className="bg-white/5 px-2 py-0.5 rounded-full">{allocations.filter(a => isPastAllocation(a.endDate)).length}</span>
                    </h3>
                    {allocations.filter(a => isPastAllocation(a.endDate)).length === 0 ? null : (
                      <ul className="space-y-3">
                        {allocations.filter(a => isPastAllocation(a.endDate)).map(alloc => (
                          <li key={alloc.id} className="bg-zinc-950 border border-white/5 rounded-2xl p-4 flex items-center justify-between shadow-[0_0_20px_rgba(0,0,0,0.3)]">
                            <div>
                               <p className="font-bold text-zinc-400 text-sm">{alloc.staffName}</p>
                               <div className="flex items-center gap-2 mt-1 font-mono text-[10px]">
                                  <span className="text-zinc-500 font-bold bg-white/5 px-1.5 py-0.5 rounded border border-white/10">{alloc.type}</span>
                                  <span className="text-zinc-500">{alloc.startDate} &rarr; {alloc.endDate}</span>
                               </div>
                            </div>
                            <div className="flex items-center gap-2">
                               <button 
                                 onClick={() => handleEditAllocation(alloc.id)}
                                 className="w-8 h-8 rounded-full bg-[#09090b] flex items-center justify-center text-zinc-600 hover:text-cyan-400 hover:bg-cyan-500/10 transition-all border border-white/5 active:scale-95"
                               >
                                  <Edit2 className="w-3.5 h-3.5" />
                               </button>
                               <button 
                                 onClick={() => handleDeleteAllocation(alloc.id)}
                                 className="w-8 h-8 rounded-full bg-[#09090b] flex items-center justify-center text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10 transition-all border border-white/5 active:scale-95"
                               >
                                  <Trash2 className="w-3.5 h-3.5" />
                               </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                 </div>
              </div>
            </div>

            {/* -------------------- MANAGE TAB -------------------- */}
            <div className={`transition-opacity duration-300 ${activeTab === 'manage' ? 'opacity-100 block' : 'opacity-0 hidden'}`}>
               
               {data.length === 0 && (
                  <div className="mb-8 rounded-3xl p-6 text-center flex flex-col items-center justify-center relative overflow-hidden group bg-zinc-900 border border-white/5">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-cyan-500/10 rounded-full blur-[60px]"></div>
                    <div className="relative z-10">
                      <div className="w-20 h-20 mx-auto mb-4 rounded-3xl bg-zinc-950 border border-white/10 flex items-center justify-center shadow-[0_0_30px_rgba(34,211,238,0.05)]">
                        <FileSpreadsheet className="w-8 h-8 text-cyan-400" />
                      </div>
                      <h2 className="text-xl font-display font-bold text-white mb-2">Initialize Hub</h2>
                      <p className="text-zinc-400 text-xs max-w-[250px] mx-auto mb-6 leading-relaxed">
                        Connect your Excel data source containing core IDs and temporal tracking rows.
                      </p>
                      <label className="relative overflow-hidden inline-flex items-center gap-3 bg-zinc-100 hover:bg-white text-[#09090b] px-6 py-3 rounded-xl font-bold uppercase tracking-wider text-[10px] shadow-[0_0_20px_rgba(255,255,255,0.1)] cursor-pointer active:scale-95 transition-all">
                        <UploadCloud className="w-4 h-4" />
                        <span>Mount Source File</span>
                        <input type="file" ref={fileInputRef} accept=".xlsx, .xls, .csv" onChange={handleFileUpload} className="hidden" />
                      </label>
                    </div>
                  </div>
               )}

               <div className="flex items-center justify-between mb-6 px-1">
                 <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center">
                      <Users className="w-4 h-4 text-rose-400" />
                    </div>
                    <h2 className="text-xl font-display font-bold text-zinc-100">Personnel Roster</h2>
                 </div>
                 <div className="flex items-center gap-2">
                    <label className="bg-zinc-800 hover:bg-zinc-700 text-cyan-200 px-3 py-2 rounded-xl text-[10px] font-mono tracking-widest uppercase flex items-center gap-2 active:scale-95 border border-white/5 transition-all cursor-pointer shadow-[0_0_10px_rgba(0,0,0,0.5)]">
                       <UploadCloud className="w-3.5 h-3.5" /> Restore DB
                       <input type="file" accept=".json" onChange={handleImportDB} className="hidden" />
                    </label>
                    <button onClick={handleExportDB} className="bg-zinc-800 hover:bg-zinc-700 text-emerald-200 px-3 py-2 rounded-xl text-[10px] font-mono tracking-widest uppercase flex items-center gap-2 active:scale-95 border border-white/5 transition-all shadow-[0_0_10px_rgba(0,0,0,0.5)]">
                      <Download className="w-3.5 h-3.5" /> Backup DB
                    </button>
                    <button onClick={handleExport} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-2 rounded-xl text-[10px] font-mono tracking-widest uppercase flex items-center gap-2 active:scale-95 border border-white/5 transition-all shadow-[0_0_10px_rgba(0,0,0,0.5)]">
                      <Download className="w-3.5 h-3.5" /> EXCEL
                    </button>
                 </div>
               </div>
               
               <div className="flex gap-3 mb-6">
                 <button 
                  onClick={() => {
                    let activeCols = columns;
                    if (columns.length === 0) {
                       activeCols = ['Serial Number', 'Employee ID', 'Employee Name', 'Designation'];
                       setColumns(activeCols);
                    }
                    const newEmpRow: RowData = { _uid: generateUid() };
                    activeCols.forEach(c => newEmpRow[c] = '');
                    setEditingStaff(newEmpRow);
                  }}
                  className="bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 px-4 py-3.5 rounded-xl font-bold flex items-center gap-2 w-full justify-center active:bg-cyan-500/20 transition-all text-xs uppercase tracking-widest shadow-inner">
                    <UserPlus className="w-4 h-4 hidden sm:block"/> Add Identity
                 </button>
               </div>

               <div className="bg-zinc-900 border border-white/5 rounded-3xl overflow-hidden shadow-[0_0_20px_rgba(0,0,0,0.3)] mb-10">
                 <ul className="divide-y divide-white/5 max-h-[45vh] overflow-y-auto">
                    {data.map(emp => (
                      <li key={String(emp._uid)} onClick={() => setEditingStaff(emp)} className="px-5 py-4 flex items-center justify-between active:bg-zinc-800 cursor-pointer group hover:bg-white/5 transition-colors">
                        <div className="flex gap-4 items-center">
                          <div className="w-10 h-10 rounded-full bg-zinc-800 border border-white/5 flex items-center justify-center text-zinc-500 font-mono text-xs group-hover:border-cyan-500/30 group-hover:text-cyan-400 transition-colors">
                            {getName(emp, columns).substring(0,2).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-zinc-200 text-sm group-hover:text-white transition-colors">{getName(emp, columns)}</p>
                              {emp['Status'] && emp['Status'] !== 'Active' && (
                                <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded-md uppercase tracking-wider ${
                                  emp['Status'] === 'Resigned' || emp['Status'] === 'Terminated' 
                                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/20' 
                                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/20'
                                }`}>
                                  {emp['Status']}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-zinc-600 font-mono mt-1 tracking-wider">{getId(emp, columns) || 'UNASSIGNED ID'}</p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-cyan-400 transition-colors" />
                      </li>
                    ))}
                 </ul>
               </div>

               {/* LEAVE ANALYTICS INTEGRATED INTO MANAGE TAB */}
               <div className="flex items-center gap-3 mb-6 px-1">
                 <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                   <BarChart3 className="w-4 h-4 text-amber-400" />
                 </div>
                 <h2 className="text-xl font-display font-bold text-zinc-100">Leave Analytics</h2>
               </div>
               
               <div className="space-y-4 pb-20">
                  {data.length === 0 ? (
                    <div className="text-center py-10 bg-zinc-900 border border-white/5 rounded-3xl">
                      <p className="text-zinc-600 font-mono text-xs">No data available yet.</p>
                    </div>
                  ) : (
                    data.map(emp => {
                       const leaveCounts: Record<string, number> = {};
                       let totalLeaves = 0;
                       
                       dateList.forEach(d => {
                          const val = String(emp[d] || '').trim().toUpperCase();
                          if (!val || val === '-' || val === 'NOT ASSIGNED' || val === 'NA') return;
                          
                          // Focus on typical leave codes
                          const isLeave = ['LEAVE', 'PL', 'CL', 'SL'].some(l => val.includes(l));
                          if (isLeave) {
                             leaveCounts[val] = (leaveCounts[val] || 0) + 1;
                             totalLeaves++;
                          }
                       });

                       // Sort leaves by count DESC
                       const topLeaves = Object.entries(leaveCounts).sort((a,b) => b[1] - a[1]);

                       if (totalLeaves === 0) return null;

                       return (
                         <div key={String(emp._uid)} className="bg-zinc-900 border border-white/5 rounded-2xl p-4 shadow-[0_0_20px_rgba(0,0,0,0.3)]">
                            <div className="flex justify-between items-start mb-3">
                               <div>
                                  <p className="font-bold text-zinc-200 text-sm">{getName(emp, columns)}</p>
                                  <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{getId(emp, columns)}</p>
                               </div>
                               <div className="bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg flex flex-col items-center justify-center">
                                  <span className="text-amber-400 font-bold text-lg leading-none">{totalLeaves}</span>
                                  <span className="text-[8px] uppercase tracking-widest text-amber-500/70 font-mono mt-0.5">Leaves</span>
                               </div>
                            </div>
                            
                            <div className="flex flex-wrap gap-2">
                               {topLeaves.map(([type, count]) => (
                                 <div key={type} className="flex border border-white/5 bg-[#09090b] rounded-md overflow-hidden text-[10px] font-mono">
                                    <span className="px-1.5 py-0.5 text-zinc-400 bg-white/5">{type}</span>
                                    <span className="px-1.5 py-0.5 text-amber-300 bg-amber-500/10 font-bold border-l border-white/5">{count}</span>
                                 </div>
                               ))}
                            </div>
                         </div>
                       );
                    })
                  )}
               </div>

            </div>
          </>
        )}
      </main>

      {/* BOTTOM NAVIGATION */}
      <nav className="fixed bottom-0 left-0 right-0 bg-[#09090b]/90 backdrop-blur-2xl border-t border-white/10 pb-7 pt-4 px-2 sm:px-4 z-40">
         <div className="max-w-md mx-auto flex justify-around">
           <button onClick={() => setActiveTab('daily')} className={`flex flex-col items-center gap-1.5 w-[60px] sm:w-16 transition-colors ${activeTab === 'daily' ? 'text-cyan-400' : 'text-zinc-600 hover:text-zinc-400'}`}>
             <Calendar className="w-5 h-5"/> <span className="text-[9px] uppercase tracking-widest font-bold">Daily</span>
           </button>
           <button onClick={() => setActiveTab('monthly')} className={`flex flex-col items-center gap-1.5 w-[60px] sm:w-16 transition-colors ${activeTab === 'monthly' ? 'text-indigo-400' : 'text-zinc-600 hover:text-zinc-400'}`}>
             <Map className="w-5 h-5"/> <span className="text-[9px] uppercase tracking-widest font-bold">Summary</span>
           </button>
           <button onClick={() => setActiveTab('grid')} className={`flex flex-col items-center gap-1.5 w-[60px] sm:w-16 transition-colors ${activeTab === 'grid' ? 'text-orange-400' : 'text-zinc-600 hover:text-zinc-400'}`}>
             <Table className="w-5 h-5"/> <span className="text-[9px] uppercase tracking-widest font-bold">Roster</span>
           </button>
           <button onClick={() => setActiveTab('allocate')} className={`flex flex-col items-center gap-1.5 w-[60px] sm:w-16 transition-colors ${activeTab === 'allocate' ? 'text-emerald-400' : 'text-zinc-600 hover:text-zinc-400'}`}>
             <Briefcase className="w-5 h-5"/> <span className="text-[9px] uppercase tracking-widest font-bold">Leave</span>
           </button>
           <button onClick={() => setActiveTab('manage')} className={`flex flex-col items-center gap-1.5 w-[60px] sm:w-16 transition-colors ${activeTab === 'manage' ? 'text-rose-400' : 'text-zinc-600 hover:text-zinc-400'}`}>
             <Settings2 className="w-5 h-5"/> <span className="text-[9px] uppercase tracking-widest font-bold">Profile</span>
           </button>
         </div>
      </nav>

      {/* EDIT STAFF OVERLAY */}
      {editingStaff && (
        <div className="fixed inset-0 bg-[#09090b] z-[60] flex flex-col pt-safe animate-in fade-in duration-200">
          <div className="flex items-center justify-between p-4 border-b border-white/10 bg-[#09090b]/80 backdrop-blur-xl sticky top-0 z-20">
            <h2 className="text-sm font-mono tracking-widest text-zinc-400 uppercase">Modify Identity</h2>
            <button onClick={() => setEditingStaff(null)} className="w-8 h-8 flex items-center justify-center bg-zinc-900 border border-white/10 rounded-full text-zinc-400 hover:text-white transition-colors active:scale-95">
               <X className="w-4 h-4" />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto px-5 py-6 space-y-8 pb-32">
            
            <div className="space-y-4">
               <h3 className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest flex items-center gap-2">
                 <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full"></span> Core Attributes
               </h3>
               <div className="grid gap-3">
                  <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-3 focus-within:border-cyan-500/50 transition-colors shadow-inner">
                    <label className="block text-[10px] font-mono text-zinc-600 mb-1.5 uppercase tracking-wide px-1">Current Status</label>
                    <select 
                      value={String(editingStaff['Status'] || 'Active')}
                      onChange={(e) => setEditingStaff({...editingStaff, Status: e.target.value})}
                      className="w-full bg-transparent text-zinc-100 text-sm font-bold outline-none px-1 appearance-none cursor-pointer"
                    >
                      <option value="Active">Active</option>
                      <option value="Resigned">Resigned</option>
                      <option value="On Long Leave">On Long Leave</option>
                      <option value="Terminated">Terminated</option>
                      <option value="Notice Period">Notice Period</option>
                    </select>
                  </div>
                 {columns.filter(c => isNameOrId(c)).sort((a,b) => getColumnWeight(a) - getColumnWeight(b)).map(col => (
                   <div key={col} className="bg-zinc-900/50 border border-white/5 rounded-2xl p-3 focus-within:border-cyan-500/50 transition-colors shadow-inner">
                     <label className="block text-[10px] font-mono text-zinc-600 mb-1.5 uppercase tracking-wide px-1">{col}</label>
                     <input 
                       list={String(editingStaff[col] || '').trim().length > 0 ? `suggestions-${col.replace(/[^a-zA-Z0-9]/g, '-')}` : undefined}
                       type="text" 
                       value={String(editingStaff[col] || '')}
                       onChange={(e) => {
                         setEditingStaff({...editingStaff, [col]: e.target.value});
                         const safeId = col.replace(/[^a-zA-Z0-9]/g, '-');
                         setActiveSearch({ id: `suggestions-${safeId}`, val: e.target.value });
                       }}
                       className="w-full bg-transparent text-zinc-100 text-sm font-bold placeholder-zinc-700 outline-none px-1"
                       placeholder="Enter value..."
                       autoComplete="off" 
                       onFocus={(e) => {
                         e.target.setAttribute('autocomplete', 'chrome-off');
                         const safeId = col.replace(/[^a-zA-Z0-9]/g, '-');
                         setActiveSearch({ id: `suggestions-${safeId}`, val: String(editingStaff[col] || '') });
                       }}
                     />
                   </div>
                 ))}
               </div>
            </div>

            {/* AUTOMATION MODULE */}
            <div className="space-y-4 border-t border-white/5 pt-6">
               <h3 className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                 <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></span> Automation Engine
               </h3>
               <div className="bg-gradient-to-br from-emerald-500/10 to-transparent border border-emerald-500/20 rounded-2xl p-4 shadow-[0_0_20px_rgba(16,185,129,0.05)]">
                 <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-[10px] font-mono text-zinc-500 uppercase block mb-1">Target Month</label>
                      <select value={autoMonth} onChange={e=>setAutoMonth(Number(e.target.value))} className="w-full bg-zinc-900 border border-white/10 rounded-xl p-3 text-xs font-bold text-emerald-100 outline-none focus:border-emerald-500/50">
                         {Array.from({length: 12}).map((_, i) => <option key={i} value={i}>{format(new Date(2000, i, 1), 'MMMM')}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-zinc-500 uppercase block mb-1">Year</label>
                      <select value={autoYear} onChange={e=>setAutoYear(Number(e.target.value))} className="w-full bg-zinc-900 border border-white/10 rounded-xl p-3 text-xs font-bold text-emerald-100 outline-none focus:border-emerald-500/50">
                         {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                 </div>
                 <div className="grid grid-cols-2 gap-3 mb-4">
                    <div>
                      <label className="text-[10px] font-mono text-zinc-500 uppercase block mb-1">Base Shift</label>
                      <input 
                        list={autoShift.trim().length > 0 ? "shift-suggestions" : undefined} 
                        autoComplete="off" 
                        value={autoShift} 
                        onChange={e => {
                          setAutoShift(e.target.value);
                          setActiveSearch({ id: 'shift-suggestions', val: e.target.value });
                        }} 
                        onFocus={() => setActiveSearch({ id: 'shift-suggestions', val: autoShift })}
                        className="w-full bg-zinc-900 border border-white/10 rounded-xl p-3 text-xs font-bold uppercase text-emerald-100 outline-none focus:border-emerald-500/50" 
                        placeholder="Type shift name..."
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-zinc-500 uppercase block mb-1">Weekly Off Day</label>
                      <select value={autoWoDay} onChange={e=>setAutoWoDay(Number(e.target.value))} className="w-full bg-zinc-900 border border-white/10 rounded-xl p-3 text-xs font-bold text-emerald-100 outline-none focus:border-emerald-500/50">
                         {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d,i)=><option key={i} value={i}>{d}</option>)}
                      </select>
                    </div>
                 </div>
                 <button onClick={handleAutoFill} className="w-full py-3.5 bg-emerald-500/20 text-emerald-400 font-bold uppercase text-[10px] tracking-widest rounded-xl hover:bg-emerald-500/30 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                    <Zap className="w-3.5 h-3.5" /> Execute Auto-Fill
                 </button>
               </div>
            </div>

            <div className="space-y-6 border-t border-white/5 pt-6">
               <h3 className="text-[10px] font-mono text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                 <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></span> Timeline Vectors
               </h3>
               <div className="flex overflow-x-auto gap-2 pb-2 mb-2 sticky top-[0px] bg-[#09090b] z-10 p-1 -mx-2 px-2 mask-linear">
                 <div className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 text-emerald-400 font-mono rounded-lg text-[10px] whitespace-nowrap">Grouped chronologically. Suggested values appear automatically.</div>
               </div>

               <div className="space-y-8">
                 {(() => {
                   const allProfileDates = Array.from(new Set([...dateList, ...Object.keys(editingStaff).filter(k => !isNameOrId(k) && k !== '_uid')]));
                   const filteredDates = allProfileDates.filter(date => isColumnInMonth(date, autoMonth, autoYear));
                   
                   const groups: Record<string, string[]> = {};
                   filteredDates.forEach(date => {
                     const monthMatch = date.match(/[a-zA-Z]{3,}/);
                     const groupName = monthMatch ? monthMatch[0].toUpperCase() : 'OTHER TIMELINES';
                     if (!groups[groupName]) groups[groupName] = [];
                     groups[groupName].push(date);
                   });
                   
                   Object.keys(groups).forEach(g => {
                      groups[g].sort((a, b) => {
                         const numA = parseInt(a.match(/\d+/)?.[0] || '0');
                         const numB = parseInt(b.match(/\d+/)?.[0] || '0');
                         if (numA !== numB) return numA - numB;
                         return a.localeCompare(b);
                      });
                   });

                   const monthMap: Record<string, number> = { 'JAN':1, 'FEB':2, 'MAR':3, 'APR':4, 'MAY':5, 'JUN':6, 'JUL':7, 'AUG':8, 'SEP':9, 'OCT':10, 'NOV':11, 'DEC':12 };
                   
                   return Object.keys(groups).sort((a, b) => {
                     const orderA = monthMap[a.substring(0,3)] || 99;
                     const orderB = monthMap[b.substring(0,3)] || 99;
                     if(orderA !== orderB) return orderA - orderB;
                     return a.localeCompare(b);
                   }).map(month => (
                     <div key={month} className="space-y-3">
                       <h4 className="text-[11px] font-mono font-bold text-zinc-500 uppercase tracking-widest border-b border-white/5 pb-2 flex items-center gap-2">
                         <span className="w-1 h-1 bg-zinc-600 rounded-full"></span>
                         {month}
                       </h4>
                       <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                         {groups[month].map(date => (
                           <div key={date} className="bg-zinc-900/80 border border-white/5 rounded-xl p-3 focus-within:border-indigo-500/50 transition-colors flex flex-col justify-between shadow-inner">
                             <label className="text-[10px] font-mono text-zinc-500 uppercase mb-2 truncate block">{date}</label>
                             <input 
                               list={String(editingStaff[date] || '').trim().length > 0 ? "shift-suggestions" : undefined}
                               type="text" 
                               value={String(editingStaff[date] || '')}
                               onChange={(e) => {
                                 setEditingStaff({...editingStaff, [date]: e.target.value});
                                 setActiveSearch({ id: 'shift-suggestions', val: e.target.value });
                               }}
                               onFocus={() => setActiveSearch({ id: 'shift-suggestions', val: String(editingStaff[date] || '') })}
                               className="w-full bg-transparent font-display font-bold text-indigo-100 uppercase outline-none placeholder-zinc-800"
                               placeholder="---"
                               autoComplete="off"
                             />
                           </div>
                         ))}
                       </div>
                     </div>
                   ));
                 })()}
               </div>
            </div>
            
            <div className="pt-10 mb-8 border-t border-white/5">
               <button 
                  className="w-full bg-rose-500/10 text-rose-500 text-xs font-mono uppercase tracking-widest p-4 rounded-2xl border border-rose-500/20 active:bg-rose-500/20 transition-colors"
                  onClick={() => {
                     if (confirm("Terminate this personnel record?")) {
                       const freshData = data.filter(d => d._uid !== editingStaff._uid);
                       saveDataLocally(freshData, columns);
                       setEditingStaff(null);
                     }
                  }}>
                  Terminate Record
               </button>
            </div>
          </div>

          <div className="p-5 border-t border-white/10 bg-[#09090b]/80 backdrop-blur-xl absolute bottom-0 w-full pb-safe z-20">
             <button 
               onClick={handleCommitProfileChanges}
               className="w-full bg-cyan-500 text-zinc-950 font-bold py-4 rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-[0_0_25px_rgba(34,211,238,0.3)] text-xs uppercase tracking-widest"
             >
               <Save className="w-4 h-4"/> Commit Global Changes
             </button>
          </div>
        </div>
      )}

      {/* ADD DATE OVERLAY */}
      {showAddDate && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-5 animate-in fade-in duration-200">
           <div className="bg-zinc-900 border border-white/10 rounded-[32px] p-8 w-full max-w-sm shadow-2xl relative overflow-hidden">
             
             <div className="absolute top-0 right-0 p-3">
               <button onClick={() => setShowAddDate(false)} className="p-2 text-zinc-500 hover:text-white bg-white/5 rounded-full"><X className="w-4 h-4"/></button>
             </div>

             <div className="w-12 h-12 bg-indigo-500/20 border border-indigo-500/30 rounded-2xl flex items-center justify-center mb-5">
               <Calendar className="w-6 h-6 text-indigo-400" />
             </div>

             <h2 className="text-xl font-display font-bold text-zinc-100 mb-2">Initialize Node</h2>
             <p className="text-[10px] uppercase font-mono tracking-widest text-zinc-500 mb-6 leading-relaxed">
               Format key must align with source (e.g. 05-May).
             </p>
             
             <input 
                type="text"
                autoFocus
                value={newDateInput}
                onChange={(e) => setNewDateInput(e.target.value)}
                placeholder="Target date..."
                className="w-full p-4 bg-zinc-950 border border-white/10 rounded-2xl font-mono text-zinc-100 mb-6 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-sm placeholder-zinc-700"
             />
             
             <button onClick={handleAddDateSave} className="w-full py-4 bg-indigo-500 text-white font-bold text-xs uppercase tracking-widest rounded-2xl active:scale-95 transition-all shadow-[0_0_20px_rgba(99,102,241,0.3)]">
               Mount Date
             </button>
           </div>
        </div>
      )}

      {/* EDIT ALLOCATION OVERLAY */}
      {editingAlloc && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-center justify-center p-5 animate-in fade-in duration-200">
           <div className="bg-zinc-900 border border-white/10 rounded-[32px] p-8 w-full max-w-sm shadow-2xl relative overflow-hidden">
             
             <div className="absolute top-0 right-0 p-3">
               <button onClick={() => setEditingAlloc(null)} className="p-2 text-zinc-500 hover:text-white bg-white/5 rounded-full"><X className="w-4 h-4"/></button>
             </div>

             <div className="w-12 h-12 bg-emerald-500/20 border border-emerald-500/30 rounded-2xl flex items-center justify-center mb-5">
               <Edit2 className="w-6 h-6 text-emerald-400" />
             </div>

             <h2 className="text-xl font-display font-bold text-zinc-100 mb-2">Edit Allocation</h2>
             <p className="text-[10px] uppercase font-mono tracking-widest text-zinc-500 mb-6 leading-relaxed">
               Modifying allocation for {editingAlloc.staffName}
             </p>
             
             <div className="space-y-4 mb-6">
                <div>
                  <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block mb-1">Value / Type</label>
                  <select 
                    value={editAllocType}
                    onChange={e => setEditAllocType(e.target.value)}
                    className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm font-bold text-zinc-200 outline-none focus:border-emerald-500/50 appearance-none"
                  >
                    <option value="LEAVE">Leave (General)</option>
                    <option value="PL">Privilege Leave (PL)</option>
                    <option value="CL">Casual Leave (CL)</option>
                    <option value="SL">Sick Leave (SL)</option>
                    <option value="TR">Training (TR)</option>
                    <option value="WO">Weekly Off (WO)</option>
                    <option value="C/OFF">Comp Off (C/OFF)</option>
                    <option value="-">Clear Value (-)</option>
                  </select>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block mb-1">From Node</label>
                      <select 
                        value={editAllocStart}
                        onChange={e => setEditAllocStart(e.target.value)}
                        className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm font-bold text-zinc-200 outline-none focus:border-emerald-500/50 appearance-none"
                      >
                        {dateList.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block mb-1">To Node</label>
                      <select 
                        value={editAllocEnd}
                        onChange={e => setEditAllocEnd(e.target.value)}
                        className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm font-bold text-zinc-200 outline-none focus:border-emerald-500/50 appearance-none"
                      >
                        {dateList.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                </div>
             </div>
             
             <button onClick={handleSaveEditAllocation} className="w-full py-4 bg-emerald-500 text-[#09090b] font-bold text-xs uppercase tracking-widest rounded-2xl active:scale-95 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)]">
               Save Changes
             </button>
           </div>
        </div>
      )}
    </div>
  );
}
