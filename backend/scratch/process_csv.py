import csv
import uuid
from datetime import datetime

# Define file paths
master_in_path = '/home/zenoguy/Desktop/SNPolymers/Project Cost Estimate_Screen-Master_Data.csv'
master_out_path = '/home/zenoguy/Desktop/SNPolymers/Project Cost Estimate_Screen-Master_Data_Prepared.csv'

purchase_in_path = '/home/zenoguy/Desktop/SNPolymers/Project Cost Estimate_Screen-Purchase_Data.csv'
purchase_out_path = '/home/zenoguy/Desktop/SNPolymers/Project Cost Estimate_Screen-Purchase_Data_Prepared.csv'

# Common Metadata
default_user = '+918276071523'
now_iso = datetime.now().isoformat()

def process_master_data():
    print(f"Processing {master_in_path}...")
    with open(master_in_path, mode='r', encoding='utf-8') as infile:
        reader = csv.DictReader(infile)
        
        # Prepare header mapping (mapping CSV column names to Postgres schema column names)
        fieldnames = [
            'work_order_no', 'estimate_no', 'site_details', 'state', 'district', 
            'zone', 'department', 'status', 'work_order_value', 'created_by', 'created_at', 'edited_by', 'edited_at'
        ]
        
        with open(master_out_path, mode='w', encoding='utf-8', newline='') as outfile:
            writer = csv.DictWriter(outfile, fieldnames=fieldnames)
            writer.writeheader()
            
            for row in reader:
                # Map columns and provide fallback defaults
                writer.writerow({
                    'work_order_no': row.get('Work_Order_No', '').strip(),
                    'estimate_no': row.get('Estimate_No', '').strip(),
                    'site_details': row.get('Site_Details', '').strip(),
                    'state': row.get('state', '').strip(),
                    'district': row.get('district', '').strip(),
                    'zone': row.get('Zone', '').strip(),
                    'department': row.get('Department', '').strip(),
                    'status': row.get('status', 'Running').strip(),
                    'work_order_value': '0.00',
                    'created_by': default_user,
                    'created_at': now_iso,
                    'edited_by': default_user,
                    'edited_at': now_iso
                })
    print(f"Saved prepared master data to {master_out_path}")

def process_purchase_data():
    print(f"Processing {purchase_in_path}...")
    with open(purchase_in_path, mode='r', encoding='utf-8') as infile:
        # The file has a blank first header, let's read it manually or handle it
        reader = csv.reader(infile)
        header = next(reader)
        
        # Identify the index of the "Purchase_List" column
        try:
            purchase_col_idx = header.index('Purchase_List')
        except ValueError:
            # Fallback to column index 1 if not explicitly named
            purchase_col_idx = 1
            
        fieldnames = ['id', 'name', 'is_active', 'created_by', 'created_at']
        
        with open(purchase_out_path, mode='w', encoding='utf-8', newline='') as outfile:
            writer = csv.DictWriter(outfile, fieldnames=fieldnames)
            writer.writeheader()
            
            for row in reader:
                if not row or len(row) <= purchase_col_idx:
                    continue
                name_val = row[purchase_col_idx].strip()
                if not name_val:
                    continue
                
                writer.writerow({
                    'id': str(uuid.uuid4()),
                    'name': name_val,
                    'is_active': 'true', # lowercase true/false for postgres compatibility
                    'created_by': default_user,
                    'created_at': now_iso
                })
    print(f"Saved prepared purchase data to {purchase_out_path}")

if __name__ == '__main__':
    process_master_data()
    process_purchase_data()
